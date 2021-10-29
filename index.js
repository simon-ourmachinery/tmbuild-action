// GitHub dependencies:
const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');

const utils = require("./internal/utils");
const gh_cache = require("./internal/cache");

const os = require('os');
const fs = require('fs');



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
        await exec.exec(`chmod +x ${file}`);
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

async function download(mode, tmbuild_repository, libpath, cache) {
    try {
        const path = core.getInput("path");
        const dir = (mode === 'engine' || mode === 'Engine') ? `${path}utils` : path;

        // TODO: Make work for plugins as well...
        if (cache && (mode === 'engine' || mode === 'Engine')) {
            try {
                const utils_dir = `${path}utils`;
                const hash_cache_version = await utils.hash(`${utils_dir}/tmbuild/tmbuild.c`);
                let version = "";
                if (mode === 'engine' || mode === 'Engine') {
                    version = await utils.hash(`${path}/libs.json`);
                } else {
                    version = await utils.hash(`${utils_dir}/libs.json`);
                }
                // try get cache:
                try {
                    const build_config = core.getInput("config");
                    await gh_cache.get(`${path}/bin/tmbuild/${build_config}`, "tmbuild", hash_cache_version);
                } catch (e) {
                    utils.info(`Need to re-build tmbuild`);
                    utils.info(`[debug]  ${e.message}`);
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
            utils.info(`Do not use cached tmbuild or libs in plugin mode`);
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
            await utils.cp(`${path}/bin/${build_config}/tmbuild${ending}`, `./bin/tmbuild/${build_config}`);
        }
        return true;
    } catch (e) {
        utils.info(`${e.message}`);
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
        tmbuild_path = `${xwindow} ${cwd}/bin/tmbuild/${build_config}/tmbuild${ending}`;
    } else {
        tmbuild_path = fs.existsSync(`${sdk_dir}/bin/tmbuild${ending}`) ? `${sdk_dir}/bin/tmbuild${ending}` : `${sdk_dir}/bin/${build_config}/tmbuild/${ending}`;
    }
    const usegendoc = core.getInput("gendoc") === 'true';
    const usegenhash = core.getInput("genhash") === 'true';
    const usegennode = core.getInput("gennode") === 'true';
    const useclang = (clang) ? "--clang" : "";
    const gendoc = (usegendoc) ? "--gen-doc" : "";
    const gennode = (usegennode) ? "--gen-nodes" : "";
    const genhash = (usegenhash) ? "--gen-hash" : "";
    const unit_tests = (!tests) ? "--no-unit-test" : "";

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
        if (package.length != 0) {
            await exec.exec(`${tmbuild_path} -p ${package} ${useclang}  ${gendoc} ${genhash} ${gennode} ${unit_tests}`, [], options)
        } else if (project.length != 0) {
            await exec.exec(`${tmbuild_path} -c ${build_config} --project ${project} ${useclang} ${gendoc} ${genhash} ${gennode}  ${unit_tests}`, [], options)
        } else {
            await exec.exec(`${tmbuild_path} -c ${build_config} ${useclang}  ${gendoc} ${genhash} ${gennode}  ${unit_tests}`, [], options)
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
    const path = core.getInput("path");
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
                        const hash_cache_version = await utils.hash(`${utils_dir}/tmbuild/tmbuild.c`);
                        let lib_hash_version = "";
                        if (mode === 'engine' || mode === 'Engine') {
                            lib_hash_version = await utils.hash(`${path}/libs.json`);
                        } else {
                            lib_hash_version = await utils.hash(`${utils_dir}/libs.json`);
                        }
                        // try get cache:
                        try {
                            const cwd = process.cwd();
                            await gh_cache.set(`${cwd}/bin/tmbuild/${build_config}`, `tmbuild`, hash_cache_version);
                            utils.info("Cached tmbuild!");
                        } catch (e) {
                            utils.info(`Failed to cache tmbuild ${e.message}`);
                        }
                        try {
                            await gh_cache.set(libpath, "libs", lib_hash_version);
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
