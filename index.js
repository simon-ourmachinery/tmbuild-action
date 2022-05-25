// GitHub dependencies:
const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');

const utils = require("./internal/utils");
const gh_cache = require("./internal/cache");

const os = require('os');
const fs = require('fs');
const path = require('path');



// all log content
global.log_out_content = "";

// warnings
global.log_out_warnings = "";
// errors
global.log_out_errors = "";


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

function get_sdk_dir() {
    if (process.env.TM_SDK_DIR) {
        core.debug(`make use of environment variable`);
        return process.env.TM_SDK_DIR;
    } else {
        return core.getInput("path");
    }
}

async function chmod(file) {
    let osname = os.platform();
    if (osname != "win32") {
        await exec.exec(`ls -l ${file}`);
        await exec.exec(`chmod 755 ${file}`);
    }
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
    const set_result = (data, name) => {
        const regex = /(^")|("$)/gm;
        const subst = ``;
        result = JSON.stringify(data).replace(regex, subst).replace(/\\n/g, "\\n");
        if (result.length > 1000)
            result = result.substring(0, 1000);
        core.setOutput(name, result);
    }
    set_result(global.log_out_content, "result");
    set_result(global.log_out_errors, "errors");
    set_result(global.log_out_warnings, "warnings");
}

function parseContent(content) {
    {
        let errs = utils.parseForError(content);
        global.log_out_content += errs.length != 0 ? errs : "";
        global.log_out_errors += errs.length != 0 ? errs : "";
    }
    {
        let warnings = utils.parseForWarnings(content);
        global.log_out_warnings += warnings.length != 0 ? warnings : "";
        global.log_out_content += warnings.length != 0 ? warnings : "";
    }
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
            process.stdout.write(data.toString());
        },
        stderr: (data) => {
            myError += data.toString();
            process.stdout.write(data.toString());
        }
    };

    if (path != "./")
        options.cwd = path;

    options.silent = !core.isDebug();
    try {
        await chmod(toolCall);
        if (os.platform() == "linux") {
            await exec.exec(`xvfb-run --auto-servernum ${toolCall} ${args}`, [], options);
        } else {
            await exec.exec(`${toolCall} ${args}`, [], options);
        }
        parseContent(myOutput);
        utils.info(`$[${toolCall} ${args}]>>\n${myOutput}\n`);
        return true;
    } catch (e) {
        parseContent(myOutput);
        parseContent(myError);
        utils.info(`$[${toolCall} ${args}]>>\n${myOutput}\n\n${myError}\n`);
        throw new Error(e.message);
        return false;
    }
}

async function get_tmbuild() {
    let path = core.getInput("path");
    const utils_dir = `${path}utils`;
    const build_config = core.getInput("config");
    const ending = (os.platform() == "win32") ? ".exe" : "";
    if (!fs.existsSync(`${path}bin/tmbuild/${build_config}/tmbuild${ending}`)) {
        const hash_cache_version = await utils.hash(`${utils_dir}/tmbuild/tmbuild.c`);
        try {
            if (path == "./")
                path = process.cwd();
            let ret = await gh_cache.get(`${path}/bin/tmbuild/${build_config}`, "tmbuild", hash_cache_version);
            utils.info(`Path: ${ret}`);
            core.setOutput("tmbuild-cache-key", gh_cache.get_key("tmbuild", hash_cache_version));
            core.setOutput("tmbuild-cache-path", `${path}/bin/tmbuild/${build_config}`);
            return ret != undefined;
        } catch (e) {
            utils.info(`Need to re-build tmbuild`);
            utils.info(`[debug]  ${e.message}`);
            return false;
        }
    } else {
        utils.info(`file: ${path}bin/tmbuild/${build_config}/tmbuild${ending} exists!`);
        return true;
    }
}

async function download(mode, tmbuild_repository, libpath, cache) {
    try {
        const path = core.getInput("path");
        const dir = (mode === 'engine' || mode === 'Engine') ? `${path}utils` : path;

        // TODO: Make work for plugins as well...
        if (cache && (mode === 'engine' || mode === 'Engine')) {
            try {
                const utils_dir = `${path}utils`;
                let version = "";
                if (mode === 'engine' || mode === 'Engine') {
                    version = await utils.hash(`${path}/libs.json`);
                } else {
                    version = await utils.hash(`${utils_dir}/libs.json`);
                }
                if (await get_tmbuild()) {
                    utils.info("Downloaded tmbuild");
                } else {
                    utils.info("Could not download tmbuild..");
                }
                try {
                    const lib_path = (mode === 'engine' || mode === 'Engine') ? libpath : get_lib_path();
                    await gh_cache.get(lib_path, "libs", version);
                } catch (e) {
                    utils.info("Need to download libs");
                }
            } catch (e) {
                utils.info(`cannot get cache: ${e.message}`);
            }
        } else {
            utils.info(`Do not use cached tmbuild or libs.`);
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
                        utils.info(`Download ${tool_url} to ${dest_path}`);
                        if (!fs.existsSync(dest_path)) {
                            utils.info(`Did not find ${dest_path}, download it`);
                            const zip_path = await tc.downloadTool(`${tool_url}`);
                            utils.info(`extract ${zip_path} to ${libpath}`);
                            let extractedFolder = await tc.extractZip(zip_path, libpath);
                            utils.info(`Extracted ${extractedFolder}`);
                        } else {
                            utils.info(`Found ${dest_path} already!`);
                        }
                    }
                }
                if (value['build-platforms'] != undefined) {
                    if (value['build-platforms'][0] == osname) {
                        const tool_name = value.lib;
                        const tool_url = `${tmbuild_repository}${tool_name}.zip`;
                        const dest_path = `${libpath}/${tool_name}.zip`;
                        utils.info(`Download ${tool_url} to ${dest_path}`);
                        if (!fs.existsSync(dest_path)) {
                            utils.info(`Did not find ${dest_path}, download it`);
                            const zip_path = await tc.downloadTool(`${tool_url}`);
                            utils.info(`extract ${zip_path} to ${libpath}`);
                            let extractedFolder = await tc.extractZip(zip_path, libpath);
                            utils.info(`Extracted ${extractedFolder}`);
                        } else {
                            utils.info(`Found ${dest_path} already!`);
                        }
                    }
                }
            }
        } else if (tmbuild_repository.includes(".zip")) {
            utils.info(`Download ${tmbuild_repository}`);
            const zip_path = await tc.downloadTool(`${tmbuild_repository}`);
            const extractedFolder = await tc.extractZip(zip_path, `${libpath}/engine_bin`);
            utils.info(`Extracted ${extractedFolder}`);
            core.exportVariable('TM_SDK_DIR', extractedFolder);
            process.env['TM_SDK_DIR'] = extractedFolder;
        } else {
            core.info(`Nothing todo...`);
        }
        return true;
    } catch (e) {
        core.error(`${e.message}`);
    }
    return false;
}
async function build_tmbuild(build_config) {
    core.debug(`build platform os: ${os.platform()}`);
    utils.info(`build config: ${build_config}`);
    const path = core.getInput("path");
    // setup logging:
    const options = {};
    options.listeners = {
        stdout: (data) => {
            parseContent(data.toString());
            process.stdout.write(data.toString());
        },
        stderr: (data) => {
            parseContent(data.toString());
            process.stdout.write(data.toString());
        }
    };
    if (path != "./")
        options.cwd = path;

    options.silent = !core.isDebug();
    // building tmbuild:
    try {
        if (os.platform() == "linux") {
            await exec.exec(`make tmbuild config=${build_config.toLowerCase()}_linux`, [], options)
        } else {
            if (os.platform() == "win32") {
                await exec.exec(`msbuild.exe "build/tmbuild/tmbuild.vcxproj" /p:Configuration="${build_config}" /p:Platform=x64`, [], options)
            } else {
                if (os.platform() == "darwin") {
                    await exec.exec(`xcodebuild -project build/tmbuild/tmbuild.xcodeproj -configuration ${build_config}`, [], options)
                }
            }
        }
        utils.info(`move tmbuild`);
        // move tmbuild:
        const ending = (os.platform() == "win32") ? ".exe" : "";
        let local_path = path;
        if (path == "./") {
            local_path = process.cwd();
        }
        if (fs.existsSync(`${local_path}/bin/${build_config}/tmbuild${ending}`)) {
            await utils.cp(`${local_path}/bin/${build_config}/tmbuild${ending}`, `${local_path}/bin/tmbuild/${build_config}`);
            return true;
        } else {
            utils.info(`Path does not exist! ${local_path}/bin/${build_config}/tmbuild${ending}`);
            return false;
        }
    } catch (e) {
        utils.warning(`${e.message}`);
        return false;
    }
}

async function run_unit_tests(tests) {
    core.debug(`tests platform os: ${os.platform()}`);
    utils.info(`tests config: ${JSON.stringify(tests)}`);
    const mode = core.getInput("mode");
    const path = core.getInput("path");
    const build_config = core.getInput("config");
    // setup logging:
    const options = {};
    options.listeners = {
        stdout: (data) => {
            parseContent(data.toString());
            process.stdout.write(data.toString());
        },
        stderr: (data) => {
            parseContent(data.toString());
            process.stdout.write(data.toString());
        }
    };

    if (path != "./")
        options.cwd = path;

    options.silent = !core.isDebug();
    try {
        const xwindow = (os.platform() == "linux") ? "xvfb-run --auto-servernum " : "";
        const ending = (os.platform() == "win32") ? ".exe" : "";
        const sdk_dir = get_sdk_dir();
        const exec_path = (mode === 'engine' || mode === 'Engine') ? `${path}bin/${build_config}/unit-test${ending}` : `${sdk_dir}/bin/unit-test${ending}`;
        if (fs.existsSync(exec_path)) {
            for (i = 0; i < tests.length; i++) {
                const test = tests[i];
                utils.info(`run test: ${test}`);
                const code = await exec.exec(`${xwindow} ${exec_path} -t ${test}`, [], options)
                if (code) {
                    return false;
                }
            }
        } else {
            utils.info(`Cannot find: ${exec_path}`);
        }
        return true;
    } catch (e) {
        utils.info(`${e.message}`);
        return false;
    }
}

async function find_tmbuild() {
    const ending = (os.platform() == "win32") ? ".exe" : "";
    const xwindow = (os.platform() == "linux") ? "xvfb-run --auto-servernum " : "";
    const sdk_dir = get_sdk_dir();
    // we check first: the sdk dir:
    let paths = [
        `tmbuild${ending}`,
        `${sdk_dir}/tmbuild${ending}`,
        `${sdk_dir}/bin/tmbuild${ending}`,
        `/bin/Debug/tmbuild${ending}`,
        `/bin/Release/tmbuild${ending}`,
        `${sdk_dir}/bin/Release/tmbuild${ending}`,
        `${sdk_dir}/bin/Debug/tmbuild${ending}`
    ];
    for (let i = 0; i < paths.length; i++) {
        if (fs.existsSync(paths[i]) && fs.lstatSync(paths[i]).isFile()) {
            await chmod(paths[i]);
            return `${xwindow} ${paths[i]}`;
        } else {
            utils.info(`Cannot find 'tmbuild' at ${paths[i]}`);
        }
    }
    return undefined;
}

async function build_engine(clang, build_config, project, package) {
    const mode = core.getInput("mode");
    const path = core.getInput("path");
    const tests = core.getInput("tests") === 'true';
    const ending = (os.platform() == "win32") ? ".exe" : "";
    const xwindow = (os.platform() == "linux") ? "xvfb-run --auto-servernum " : "";
    const sdk_dir = get_sdk_dir();
    const cwd = process.cwd();
    let tmbuild_path = "";
    if ((mode === 'engine' || mode === 'Engine')) {
        if (path == "./") {
            tmbuild_path = `${xwindow} ${cwd}/bin/tmbuild/${build_config}/tmbuild${ending}`;
        } else {
            tmbuild_path = `${xwindow} ${path}/bin/tmbuild/${build_config}/tmbuild${ending}`;
        }
    } else {
        tmbuild_path = await find_tmbuild();
        if (tmbuild_path === undefined) {
            utils.error(`Cannot find 'tmbuild'`);
            return false;
        }
    }
    const usegendoc = core.getInput("gendoc") === 'true';
    const usegenhash = core.getInput("genhash") === 'true';
    const usegennode = core.getInput("gennode") === 'true';
    const useclean = core.getInput("clean") === 'true';
    const build_server = core.getInput("build-server") === 'true';
    const usebuildserver = (build_server) ? "--premake-build-server" : "";
    const useclang = (clang) ? "--clang" : "";
    const gendoc = (usegendoc) ? "--gen-doc" : "";
    const gennode = (usegennode) ? "--gen-nodes" : "";
    const genhash = (usegenhash) ? "--gen-hash" : "";
    const unit_tests = (!tests) ? "--no-unit-test" : "";
    const clean = (useclean) ? "--clean" : "";

    // setup logging:
    const options = {};
    options.listeners = {
        stdout: (data) => {
            parseContent(data.toString());
            process.stdout.write(data.toString());
        },
        stderr: (data) => {
            parseContent(data.toString());
            process.stdout.write(data.toString());
        }
    };

    if (path != "./")
        options.cwd = path;

    if (os.platform() == "win32") {
        await exec.exec(`TAKEOWN /r /d Y /F bin`, [], options);
    }

    options.silent = !core.isDebug();
    try {
        if (package.length != 0) {
            await exec.exec(`${tmbuild_path} -p ${package} ${useclang} ${clean} ${gendoc} ${genhash} ${gennode} ${unit_tests} ${usebuildserver}`, [], options)
        } else if (project.length != 0) {
            await exec.exec(`${tmbuild_path} -c ${build_config} --project ${project} ${clean} ${useclang} ${gendoc} ${genhash} ${gennode}  ${unit_tests}  ${usebuildserver}`, [], options)
        } else {
            await exec.exec(`${tmbuild_path} -c ${build_config} ${useclang} ${clean}  ${gendoc} ${genhash} ${gennode}  ${unit_tests}  ${usebuildserver}`, [], options)
        }
        return true;
    } catch (e) {
        utils.info(`${e.message}`);
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
    let path = core.getInput("path");
    core.debug(`folder: ${path}`);
    const unit_tests_json_str = core.getInput("unit-tests");
    const unit_tests = unit_tests_json_str.length ? JSON.parse(unit_tests_json_str) : null;
    const shall_run_unit_tests = Array.isArray(unit_tests);
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

            if (!shall_run_unit_tests) {
                let tmbuild_successfully_downloaded = true;
                await core.group("pre tmbuild step", async () => {
                    tmbuild_successfully_downloaded = (await get_tmbuild());
                    core.info(`Skip build engine since we only build tmbuild ${tmbuild_successfully_downloaded}`);
                });
                if (!tmbuild_successfully_downloaded || !cache) {
                    if (!await core.group("build tmbuild", async () => { return build_tmbuild(build_config); })) {
                        await report(false, "build tmbuild");
                        return;
                    }
                } else {
                    core.info("Skip tmbuild since it was already build and or latest cached!");
                }
                // be smart and do not build tmbuild again if tmbuild is the project!
                if (project != "tmbuild") {
                    if (!await core.group("build engine", async () => { return build_engine(clang, build_config, project, package); })) {
                        await report(false, "build the engine");
                        return;
                    }
                } else {
                    core.info("Skip build engine since we only build tmbuild");
                }
                if (cache) {
                    // set cache:
                    try {
                        const utils_dir = (mode === 'engine' || mode === 'Engine') ? `${path}utils` : `${path}code/utils`;
                        const hash_cache_version = await utils.hash(`${utils_dir}/tmbuild/tmbuild.c`);
                        let lib_hash_version = "";
                        if (mode === 'engine' || mode === 'Engine') {
                            lib_hash_version = await utils.hash(`${path}/libs.json`);
                        } else {
                            lib_hash_version = await utils.hash(`${utils_dir}/libs.json`);
                        }
                        // try get cache:
                        try {
                            if (path == "./")
                                path = process.cwd();
                            if (fs.existsSync(`${path}/bin/tmbuild/${build_config}`)) {
                                let id = await gh_cache.set(`${path}/bin/tmbuild/${build_config}`, `tmbuild`, hash_cache_version);
                                utils.info(`CacheId: ${id}`);
                                core.setOutput("tmbuild-cache-key", gh_cache.get_key("tmbuild", hash_cache_version));
                                core.setOutput("tmbuild-cache-path", `${path}/bin/tmbuild/${build_config}`);
                                utils.info(`Cached tmbuild key: ${gh_cache.get_key("tmbuild", hash_cache_version)}`);
                            } else {
                                utils.info(`Failed to cache tmbuild: ${path}/bin/tmbuild/${build_config}`);
                            }
                        } catch (e) {
                            utils.info(`Failed to cache tmbuild ${e.message}`);
                        }
                        try {
                            let id = await gh_cache.set(libpath, "libs", lib_hash_version);
                            utils.info(`CacheId: ${id}`);
                            utils.info("Cached libs!");
                        } catch (e) {
                            utils.info(`Failed to cache libs ${e.message}`);
                        }
                    } catch (e) {
                        utils.info(`cannot get cache: ${e.message}`);
                    }
                }
            } else {
                if (!await core.group("run unit-tests", async () => { return run_unit_tests(unit_tests); })) {
                    await report(false, "unit-tests");
                    return;
                }
            }
            report(true, "finished");
        } else if (mode === 'plugin' || mode === 'Plugin') {
            if (binary_repository != "Null") {
                if (!await core.group("download engine", async () => { return download(mode, binary_repository, process.env.GITHUB_WORKSPACE, cache); })) {
                    await report(false, "download engine");
                    return;
                }
            } else {
                utils.info(`Do not download the engine... no binary repository is given`);
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
