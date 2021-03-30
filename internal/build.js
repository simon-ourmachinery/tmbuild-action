// GitHub dependencies:
const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const cache = require('@actions/cache');
const utils = require("./utils");
const tools = require("./tools");

const os = require('os');
const fs = require('fs');

/**
 */
async function build_tmbuild(buildconfig) {
    core.debug(`os: ${os.platform()}`);
    buildconfig = (buildconfig == undefined) ? utils.getInput("buildconfig") : buildconfig;
    if (buildconfig == "") throw Error("No build config is set!");
    core.debug(`buildconfig: ${buildconfig}`);

    let myOutput = '';
    let myError = '';
    const options = {};
    options.listeners = {
        stdout: (data) => {
            myOutput += data.toString();
        },
        stderr: (data) => {
            myError += data.toString();
        }
    };
    options.silent = !core.isDebug();

    try {
        if (os.platform() == "linux") {
            await exec.exec(`make tmbuild config=${buildconfig.toLowerCase()}_linux`, [], options)
        } else
            if (os.platform() == "win32") {
                await exec.exec(`msbuild.exe "build/tmbuild/tmbuild.vcxproj" /p:Configuration="${buildconfig} Win64" /p:Platform=x64`, [], options)
            } else
                if (os.platform() == "darwin") {
                    await exec.exec(`xcodebuild -project build/tmbuild/tmbuild.xcodeproj -configuration ${buildconfig}`, [], options)
                }
        core.startGroup("[tmbuild-action] build tmbuild")
        utils.info(`Build config: ${buildconfig}`)
        if (options.silent) {
            utils.info(`\n${myOutput}\n`);
        }

        let res = utils.parseForError(myOutput);
        global.log_out_content += res.length != 0 ? res : "";
        res = utils.parseForError(myError)
        global.log_out_content += res.length != 0 ? res : "";
        core.endGroup();
    } catch (e) {
        let res = utils.parseForError(myOutput);
        global.log_out_content += res.length != 0 ? res : "";
        res = utils.parseForError(myError)
        global.log_out_content += res.length != 0 ? res : "";
        utils.info(myOutput)
        utils.info(myError)
        throw new Error(e.message);
    }
}
exports.build_tmbuild = build_tmbuild;

async function make() {
    const tool = "premake5";
    if (os.platform() == "linux") {
        await tools.exec(tool, "--file=premake5.lua gmake");
    } else if (os.platform() == "win32") {
        await tools.exec(tool, "--file=premake5.lua vs2019");
    } else if (os.platform() == "darwin") {
        await tools.exec(tool, "--file=premake5.lua xcode4");
    }
}
exports.make = make;

async function tmbuild(package) {
    const buildconfig = utils.getInput("buildconfig");
    const project = utils.getInput("project");
    const clang = utils.getInput("clang");
    let useclang = (clang === "true") ? "--clang" : "";
    if (package.length != 0) {
        await tools.exec("tmbuild", `-p ${package} ${useclang}`);
    } else if (project.length != 0) {
        await tools.exec("tmbuild", `-c ${buildconfig} --project ${project} ${useclang}`);
    } else
        await tools.exec("tmbuild", `-c ${buildconfig} ${useclang}`);
}
}
exports.tmbuild = tmbuild;
