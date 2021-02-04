// GitHub dependencies:
const core = require('@actions/core');
const e = require('@actions/exec');
const tc = require('@actions/tool-cache');
const utils = require("./utils");
const artifact = require('@actions/artifact');
const glob = require('@actions/glob');

const os = require('os');
const fs = require('fs');

async function chmod(file) {
    await e.exec(`chmod +x ${file}`);
}

exports.chmod = chmod;


async function rm(file, tool) {
    await e.exec(`rm ${file}`);
}

exports.rm = rm;

async function mv(oldn, newn) {
    await e.exec(`mv ${oldn} ${newn}`);
}

exports.mv = mv;

/**
 * Downloads a tool either from cache or from repo depends on if cache shall be used or if its caches
 * @param tool name of the tool
 * @param alternativeRepo?: alternativeRepo
 */
async function install(tool, alternativeRepo) {
    core.startGroup(`[tmbuild-action] install ${tool}`);
    utils.debug(`tool: ${tool}`);
    const repo = (alternativeRepo == undefined) ? utils.getInput("repo") : alternativeRepo;
    const libjson = utils.parseLibsFile(utils.getInput("libjsonpath"));
    const toolObject = (tool != "tmbuild") ? utils.getLib(libjson, tool) : { lib: "tmbuild" };
    const toolname = toolObject.lib;
    const toolUrl = `${repo}${toolname}.zip`;
    utils.debug(`repo: ${repo}`);
    utils.debug(`toolUrl: ${toolUrl}`);
    utils.info(`could not find ${tool} in tools cache downloads it from ${toolUrl}`);
    const zipPath = await tc.downloadTool(`${toolUrl}`);
    let extractedFolder = await tc.extractZip(zipPath, utils.getInput("libpath"));
    utils.info(`extractedFolder ${tool} path: ${extractedFolder}`);
    core.endGroup();
    return extractedFolder;
}
exports.install = install;

/**
 * executes a tool from provided path
 * @param tool name of the tool or path to tool
 * @param args tool arguments (str)
 */
async function exec(tool, args) {
    core.startGroup(`[tmbuild-action] execute ${tool}`);
    const ending = (os.platform() == "win32") ? ".exe" : "";

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
        const libJson = utils.parseLibsFile(utils.getInput("libjsonpath"));
        const toolPath = utils.getLibPath(libJson, tool);
        utils.info(`${tool} is in ${toolPath}`);
        const toolCall = `${toolPath}/${tool}${ending}`;
        if (!fs.existsSync(toolCall)) throw new Error(`Error: Could not find ${tool} here: ${toolCall}`);
        await chmod(toolCall);
        if (os.platform() == "linux") {
            await e.exec(`xvfb-run --auto-servernum ${toolCall} ${args}`, [], options);
        } else {
            await e.exec(`${toolCall} ${args}`, [], options);
        }
        let res = utils.parseForError(myOutput);
        global.log_out_content += res.length != 0 ? res : "";
        utils.info(`$[${toolCall} ${args}]>>\n${myOutput}\n`);
    } catch (e) {
        let res = utils.parseForError(myOutput);
        global.log_out_content += res.length != 0 ? res : "";
        res = utils.parseForError(myError)
        global.log_out_content += res.length != 0 ? res : "";
        utils.info(`$[${tool} ${args}]>>\n${myOutput}\n\n${myError}\n`);
        throw new Error(e.message);
    }
    core.endGroup();
}
exports.exec = exec;


async function storeFolder(artifactName, path) {

    let files = [];
    const globber = await glob.create(path)
    for await (const file of globber.globGenerator()) {
        if (!file.includes(".zip")) {
            files.push(file);
        }
    }
    const artifactClient = artifact.create()
    const rootDirectory = '.' // Also possible to use __dirname
    const options = {
        continueOnError: false
    }
    const uploadResponse = await artifactClient.uploadArtifact(artifactName, files, rootDirectory, options);
    core.info(uploadResponse);
}
exports.storeFolder = storeFolder;

async function storeFile(artifactName, path) {

    let files = [];
    const globber = await glob.create(path)
    for await (const file of globber.globGenerator()) {
        files.push(file);
    }
    const artifactClient = artifact.create()
    const rootDirectory = '.' // Also possible to use __dirname
    const options = {
        continueOnError: false
    }
    const uploadResponse = await artifactClient.uploadArtifact(artifactName, files, rootDirectory, options);
    core.info(uploadResponse);
}
exports.storeFile = storeFile;