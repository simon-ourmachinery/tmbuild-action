const core = require('@actions/core');
const exec = require('@actions/exec');
const os = require('os');
const fs = require('fs');
const yaml = require('js-yaml');
const { tmbuild } = require('./build');


function info(msg) {
    core.info(`[tmbuild-action] ${msg}`);
}
exports.info = info;
function debug(msg) {
    core.debug(`[tmbuild-action] ${msg}`);
}
exports.debug = debug;
function error(msg) {
    core.error(`[tmbuild-action] ${msg}`);
}
exports.error = error;
function warning(msg) {
    core.warning(`[tmbuild-action] ${msg}`);
}
exports.error = warning;



async function cp(src, dest) {
    core.startGroup(`[tmbuild-action] copy files src: ${src} dest: ${dest}`);
    if (os.platform() == "win32") {
        await exec.exec(`powershell.exe New-Item -Path "${dest}" -ItemType Directory -Force`)
        await exec.exec(`powershell.exe Copy-Item -Path "${src}" -Destination "${dest}" -Recurse -Force`)
    } else {
        await exec.exec(`mkdir -p ${dest}`)
        await exec.exec(`cp -avp  ${src} ${dest}`)
    }
    core.endGroup();
}
exports.cp = cp;
async function cpDir(src, dest) {
    if (os.platform() == "win32") {
        await cp(`${src}/*`, dest);
    } else {
        await cp(src, dest);
    }
}
exports.cpDir = cpDir;


function seg_fault(str) {
    const regex = /Segmentation fault \(core dumped\)/gm;
    let m;

    while ((m = regex.exec(str)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === regex.lastIndex) {
            regex.lastIndex++;
        }

        if (m.length >= 2) {
            return true;
        }
    }
    return false;
}


function contains_not_found(str) {
    const regex = /tmbuild: No ([aA-zZ\-.]+) executable found./gm;
    let m;

    while ((m = regex.exec(str)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === regex.lastIndex) {
            regex.lastIndex++;
        }

        if (m.length >= 2) {
            return true;
        }
    }
    return false;
}

function parseForError(content) {
    try {
        let result = "";
        const has_seg_fault = seg_fault(content);
        if (content.includes("tmbuild:")) {
            // tmbuild error:
            const regex_tm = /^tmbuild:(.*)$/gm;
            while ((m = regex_tm.exec(content)) !== null) {
                // This is necessary to avoid infinite loops with zero-width matches
                if (m.index === regex_tm.lastIndex) {
                    regex_tm.lastIndex++;
                }
                if (m.length >= 2) {
                    core.error(m[0].trim());
                    result += `${m[0].trim()}\n`
                } else {
                    result += "tmbuild: failed\n";
                }
            }
        } else if (content.includes("docgen:")) {
            // tmbuild error:
            core.info("found docgen information");
            const regex_tm = /docgen:(.*)$/gm;
            while ((m = regex_tm.exec(content)) !== null) {
                if (m.index === regex_tm.lastIndex) {
                    regex_tm.lastIndex++;
                }
                if (m.length >= 2) {
                    core.error(m[0].trim());
                    result += `${m[0].trim()}\n`
                } else {
                    result += "docgen: failed\n";
                }
            }
        } else {
            const regex_err = /(.*)error:(.*)|(.*)Error:(.*)|(.*)error :(.*)|(.*)Error :(.*)/gm;
            while ((m = regex_err.exec(content)) !== null) {
                // This is necessary to avoid infinite loops with zero-width matches
                if (m.index === regex_err.lastIndex) {
                    regex_err.lastIndex++;
                }
                if (m[1] != undefined && m[2] != undefined) {
                    core.error(`file:${m[1].trim()}\nerror: ${m[2].trim()}\n`)
                    result += `file:\`${m[1].trim()}\`error: \`${m[2].trim()}\`\n`
                } else {
                    core.error(`${m[0].trim()}\n`)
                    result += `error:${m[0].trim()}\n`
                }
            }

            const regex_war = /(.*)warning:(.*)|(.*)Warning:(.*)|(.*)warning :(.*)|(.*)Warning :(.*)/gm;
            while ((m = regex_war.exec(content)) !== null) {
                // This is necessary to avoid infinite loops with zero-width matches
                if (m.index === regex_war.lastIndex) {
                    regex_war.lastIndex++;
                }
                if (m[1] != undefined && m[2] != undefined) {
                    core.warning(`file:${m[1].trim()}\nwarning: ${m[2].trim()}\n`);
                    result += `file:\`${m[1].trim()}\`warning: \`${m[2].trim()}\`\n`
                } else {
                    core.warning(`${m[0].trim()}\n`)
                    result += `warning:${m[0].trim()}\n`;
                }
            }
        }
        if (has_seg_fault) {
            core.error("Segmentation fault (core dumped)");
            result += `error: found crash: \`Segmentation fault (core dumped)\`\n${result}\n`;
        }
        return result;
    } catch {
        return "[tmbuild-action] error parsing error!\n";
    }
}

function parseLibsFile(libpath) {
    if (fs.existsSync(`${libpath}/libs.json`)) {
        return JSON.parse(fs.readFileSync(`${libpath}/libs.json`));
    } else {
        throw new Error(`cannot load libfile: ${libpath}/libs.json`);
    }
}
/**
 * loads lib information from libs.json
 * @param libjson libjson to parse
 * @param lib name
 */
function getLib(libjson, lib) {
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


function getLibPath(libjson, lib) {
    if (lib != "tmbuild") {
        const libobject = getLib(libjson, lib);
        const libfolder = getInput("libpath");
        return `${libfolder}/${libobject.lib}`;
    } else {
        const buildconfig = getInput("buildconfig");
        return `./bin/tmbuild/${buildconfig}`;
    }
}


const args = process.argv.slice(2);
let inputs = null;
let isDebug = false;
if (args.length >= 1 && args[0] == "debug") {
    isDebug = true;
    process.env.RUNNER_TOOL_CACHE = "./cache";
    process.env.RUNNER_TEMP = "./tmp";
    process.env.RUNNER_DEBUG = "1";
    try {
        inputs = yaml.safeLoad(fs.readFileSync('action.yaml', 'utf8'))['inputs'];
    } catch (e) {
        info(e.message);
    }
}

function getInput(key) {
    if (isDebug) {
        return inputs[key].default;
    }
    return core.getInput(key);
}

exports.parseLibsFile = parseLibsFile;
exports.getLib = getLib;
exports.parseForError = parseForError;
exports.getInput = getInput;
exports.getLibPath = getLibPath;
