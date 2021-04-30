// GitHub dependencies:
const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');

const utils = require("./internal/utils");
const gh_cache = require("./internal/cache");

const os = require('os');
const fs = require('fs');


global.log_out_content = "";
const engine_lib_json_path = "./utils/libs.json";



function parse_libs_file(lib_path) {
    if (fs.existsSync(`${lib_path}/libs.json`)) {
        return JSON.parse(fs.readFileSync(`${lib_path}/libs.json`));
    } else {
        throw new Error(`cannot load libfile: ${lib_path}/libs.json`);
    }
}

function get_lib_path() {
    const libpath = core.getInput("libpath");
    if (process.env.TM_LIB_DIR && libpath === './lib') {
        core.debug(`make use of environment variable`);
        return process.env.TM_LIB_DIR;
    } else {
        return libpath;
    }
}

async function chmod(file) {
    await exec.exec(`chmod +x ${file}`);
}

function get_lib(libjson, lib) {
    let osname = os.platform();
    osname = (osname == "win32") ? "windows" : (osname == "darwin") ? "osx" : "linux";
    for (const [key, value] of Object.entries(libjson)) {
        if (value.role == lib) {
            if (value['target-platforms'] != undefined) {
                if (value['target-platforms'][0] == osname) return value;
            }
            if (value['build-platforms'] != undefined) {
                if (value['build-platforms'][0] == osname) return value;
            }
        }
    }
    throw new Error(`cannot find lib: ${lib}`);
}

function report(status, stage) {
    if (!status) {
        core.setFailed(`Build Failed in stage ${stage}`);
    }
    const regex = /(^")|("$)/gm;
    const subst = ``;
    const result = JSON.stringify(global.log_out_content).replace(regex, subst).replace(/\\n/g, "\\n");
    core.setOutput(`result`, result);
}

async function premake(args) {
    const mode = core.getInput("mode");
    const path = core.getInput("path");
    const lib_json_file_path = (mode === 'engine' || mode === 'Engine') ? `${path}utils` : path;
    const lib_json = parse_libs_file(lib_json_file_path);
    const ending = (os.platform() == "win32") ? ".exe" : "";
    const premake = get_lib(lib_json, "premake5");
    const lib_path = get_lib_path();
    // make sure path exists:
    const toolCall = `${lib_path}/${premake.lib}/premake5${ending}`;
    if (!fs.existsSync(toolCall)) throw new Error(`Error: Could not find premake here: ${toolCall}`);
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
        await chmod(toolCall);
        if (os.platform() == "linux") {
            await exec.exec(`xvfb-run --auto-servernum ${toolCall} ${args}`, [], options);
        } else {
            await exec.exec(`${toolCall} ${args}`, [], options);
        }
        let res = utils.parseForError(myOutput);
        global.log_out_content += res.length != 0 ? res : "";
        core.info(`$[${toolCall} ${args}]>>\n${myOutput}\n`);
        return true;
    } catch (e) {
        let res = utils.parseForError(myOutput);
        global.log_out_content += res.length != 0 ? res : "";
        res = utils.parseForError(myError)
        global.log_out_content += res.length != 0 ? res : "";
        core.info(`$[${toolCall} ${args}]>>\n${myOutput}\n\n${myError}\n`);
        throw new Error(e.message);
        return false;
    }
}

async function download(mode, tmbuild_repository, libpath, cache) {
    try {
        const path = core.getInput("path");
        const dir = (mode === 'engine' || mode === 'Engine') ? `${path}utils` : path;

        if (cache) {
            try {
                const utils_dir = (mode === 'engine' || mode === 'Engine') ? `${path}utils` : `${path}code/utils`;
                const cache_version = await utils.hash(`${utils_dir}/tmbuild/tmbuild.c`);
                let version = "";
                if (mode === 'engine' || mode === 'Engine') {
                    version = await utils.hash(`${path}/libs.json`);
                } else {
                    version = await utils.hash(`${utils_dir}/libs.json`);
                }
                // try get cache:
                try {
                    const build_config = core.getInput("config");
                    await gh_cache.get(`${path}/bin/tmbuild/${build_config}`, "tmbuild", cache_version);
                } catch (e) {
                    core.info(`Need to re-build tmbuild`);
                    core.info(`[debug]  ${e.message}`);
                }
                try {
                    const lib_path = (mode === 'engine' || mode === 'Engine') ? libpath : get_lib_path();
                    await gh_cache.get(lib_path, "libs", version);
                } catch (e) {
                    core.info("Need to download libs");
                }
            } catch (e) {
                core.info(`cannot get cache: ${e.message}`);
            }
        }

        if (mode === 'engine' || mode === 'Engine') {
            const lib_json = parse_libs_file(dir);
            let osname = os.platform();
            osname = (osname == "win32") ? "windows" : (osname == "darwin") ? "osx" : "linux";
            for (const [key, value] of Object.entries(lib_json)) {
                if (value['target-platforms'] != undefined) {
                    if (value['target-platforms'][0] == osname) {
                        const tool_name = value.lib;
                        const tool_url = `${tmbuild_repository}${tool_name}.zip`;
                        const dest_path = `${libpath}/${tool_name}.zip`;
                        core.info(`Download ${tool_url} to ${dest_path}`);
                        if (!fs.existsSync(dest_path)) {
                            const zip_path = await tc.downloadTool(`${tool_url}`);
                            let extractedFolder = await tc.extractZip(zip_path, libpath);
                            core.info(`Extracted ${extractedFolder}`);
                        } else {
                            core.info(`Found ${dest_path} already!`);
                        }
                    }
                }
                if (value['build-platforms'] != undefined) {
                    if (value['build-platforms'][0] == osname) {
                        const tool_name = value.lib;
                        const tool_url = `${tmbuild_repository}${tool_name}.zip`;
                        const dest_path = `${libpath}/${tool_name}.zip`;
                        core.info(`Download ${tool_url} to ${dest_path}`);
                        if (!fs.existsSync(dest_path)) {
                            const zip_path = await tc.downloadTool(`${tool_url}`);
                            let extractedFolder = await tc.extractZip(zip_path, libpath);
                            core.info(`Extracted ${extractedFolder}`);
                        } else {
                            core.info(`Found ${dest_path} already!`);
                        }
                    }
                }
            }
        } else {
            core.info(`Download ${tmbuild_repository}`);
            const zip_path = await tc.downloadTool(`${tmbuild_repository}`);
            const extractedFolder = await tc.extractZip(zip_path, `${libpath}/engine_bin`);
            core.info(`Extracted ${extractedFolder}`);
            core.exportVariable('TM_SDK_DIR', extractedFolder);
        }
        return true;
    } catch (e) {
        core.error(`${e.message}`);
    }
    return false;
}
async function build_tmbuild(build_config) {
    core.debug(`build platform os: ${os.platform()}`);
    core.info(`build config: ${build_config}`);
    const path = core.getInput("path");
    // setup logging:
    const options = {};
    options.listeners = {
        stdout: (data) => {
            let res = utils.parseForError(data.toString());
            process.stdout.write(data.toString());
            global.log_out_content += res.length != 0 ? res : "";
        },
        stderr: (data) => {
            let res = utils.parseForError(data.toString());
            process.stdout.write(data.toString());
            global.log_out_content += res.length != 0 ? res : "";
        }
    };
    options.silent = !core.isDebug();
    // building tmbuild:
    try {
        if (os.platform() == "linux") {
            await exec.exec(`make tmbuild config=${build_config.toLowerCase()}_linux`, [], options)
        } else
            if (os.platform() == "win32") {
                await exec.exec(`msbuild.exe "build/tmbuild/tmbuild.vcxproj" /p:Configuration="${build_config} Win64" /p:Platform=x64`, [], options)
            } else
                if (os.platform() == "darwin") {
                    await exec.exec(`xcodebuild -project build/tmbuild/tmbuild.xcodeproj -configuration ${build_config}`, [], options)
                }
        // move tmbuild:
        const ending = (os.platform() == "win32") ? ".exe" : "";
        if (fs.existsSync(`${path}bin/${build_config}/tmbuild${ending}`)) {
            await utils.cp(`${path}/bin/${build_config}/tmbuild${ending}`, `${path}bin/tmbuild/${build_config}`);
        }

        return true;
    } catch (e) {
        core.info(`${e.message}`);
        return false;
    }
}

async function build_engine(clang, build_config, project, package) {
    const mode = core.getInput("mode");
    const path = core.getInput("path");
    const ending = (os.platform() == "win32") ? ".exe" : "";
    const xwindow = (os.platform() == "linux") ? "xvfb-run --auto-servernum " : "";
    const tmbuild_path = (mode === 'engine' || mode === 'Engine') ? `${xwindow}${path}bin/tmbuild/${build_config}/tmbuild${ending}` : `${path}bin/tmbuild${ending}`;
    const usegendoc = core.getInput("gendoc") === 'true';
    const usegenhash = core.getInput("genhash") === 'true';
    const usegennode = core.getInput("gennode") === 'true';
    const useclang = (clang) ? "--clang" : "";
    const gendoc = (usegendoc) ? "--gen-doc" : "";
    const gennode = (usegennode) ? "--gen-nodes" : "";
    const genhash = (usegenhash) ? "--gen-hash" : "";

    // setup logging:
    const options = {};
    options.listeners = {
        stdout: (data) => {
            let res = utils.parseForError(data.toString());
            process.stdout.write(data.toString());
            global.log_out_content += res.length != 0 ? res : "";
        },
        stderr: (data) => {
            let res = utils.parseForError(data.toString());
            process.stdout.write(data.toString());
            global.log_out_content += res.length != 0 ? res : "";
        }
    };
    options.silent = !core.isDebug();
    try {
        if (package.length != 0) {
            await exec.exec(`${tmbuild_path} -p ${package} ${useclang}  ${gendoc} ${genhash} ${gennode}`, [], options)
        } else if (project.length != 0) {
            await exec.exec(`${tmbuild_path} -c ${build_config} --project ${project} ${useclang} ${gendoc} ${genhash} ${gennode}`, [], options)
        } else {
            await exec.exec(`${tmbuild_path} -c ${build_config} ${useclang}  ${gendoc} ${genhash} ${gennode}`, [], options)
        }
        return true;
    } catch (e) {
        core.info(`${e.message}`);
        return false;
    }
}

(async () => {
    // meta:
    const mode = core.getInput("mode");
    core.debug(`Mode: ${mode}`);
    const clang = core.getInput("clang") === 'true';
    core.debug(`Use Clang: ${clang}`);
    const package = core.getInput("package");
    core.debug(`Package: ${package}`);
    const project = core.getInput("project");
    core.debug(`Project: ${project}`);
    const build_config = core.getInput("config");
    core.debug(`Build Config: ${build_config}`);
    const tmbuild_repository = core.getInput("tmbuild_repository");
    core.debug(`tmbuild repository: ${tmbuild_repository}`);
    const binary_repository = core.getInput("binary_repository");
    core.debug(`binary_repository: ${binary_repository}`);
    const cache = core.getInput("cache") === 'true';
    core.debug(`use cache: ${cache}`);
    const libpath = get_lib_path();
    core.debug(`lib path: ${libpath}`);
    const path = core.getInput("path");
    core.debug(`folder: ${path}`);
    try {
        if (mode === 'engine' || mode === 'Engine') {
            if (!await core.group("download dependencies", async () => { return download(mode, tmbuild_repository, libpath, cache); })) {
                await report(false, "download dependencies");
                return;
            }
            if (!await core.group("premake", async () => {
                // run premake:
                try {
                    if (os.platform() == "linux") {
                        await premake("--file=premake5.lua gmake");
                    } else if (os.platform() == "win32") {
                        await premake("--file=premake5.lua vs2019");
                    } else if (os.platform() == "darwin") {
                        await premake("--file=premake5.lua xcode4");
                    }
                    return true;
                } catch (e) {
                    core.error(e.message);
                    return false;
                }
            })) {
                await report(false, "run premake");
                return;
            }
            if (!await core.group("build tmbuild", async () => { return build_tmbuild(build_config); })) {
                await report(false, "build tmbuild");
                return;
            }
            if (!await core.group("build engine", async () => { return build_engine(clang, build_config, project, package); })) {
                await report(false, "build the engine");
                return;
            }
            if (cache) {
                // set cache:
                try {
                    const utils_dir = (mode === 'engine' || mode === 'Engine') ? `${path}utils` : `${path}code/utils`;
                    const cache_version = await utils.hash(`${utils_dir}/tmbuild/tmbuild.c`);
                    let version = "";
                    if (mode === 'engine' || mode === 'Engine') {
                        version = await utils.hash(`${path}/libs.json`);
                    } else {
                        version = await utils.hash(`${utils_dir}/libs.json`);
                    }
                    // try get cache:
                    try {
                        await gh_cache.set(`${path}/bin/tmbuild/${build_config}`, `tmbuild`, cache_version);
                        core.info("Cached tmbuild!");
                    } catch (e) {
                        core.info(`Failed to cache tmbuild ${e.message}`);
                    }
                    try {
                        await gh_cache.set(libpath, "libs", version);
                        core.info("Cached libs!");
                    } catch (e) {
                        core.info(`Failed to cache libs ${e.message}`);
                    }
                } catch (e) {
                    core.info(`cannot get cache: ${e.message}`);
                }
            }
            report(true, "finished");
        } else if (mode === 'plugin' || mode === 'Plugin') {
            if (!await core.group("download engine", async () => { return download(mode, binary_repository, path, cache); })) {
                await report(false, "download engine");
                return;
            }
            if (!await core.group("build plugin", async () => { return build_engine(clang, build_config, project, package); })) {
                await report(false, "build the engine");
                return;
            }
            report(true, "finished");
        }
    } catch (e) {
        report(false, `${e.message}`);
    }
})();
