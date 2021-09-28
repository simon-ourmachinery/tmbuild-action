const core = require('@actions/core');
const exec = require('@actions/exec');
const os = require('os');
const fs = require('fs');
const yaml = require('js-yaml');

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

function parseForError(content) {
    try {
        let result = "";
        const has_seg_fault = seg_fault(content);
        if (content.includes("tmbuild:") && !content.includes("tmbuild: [delete-dirs] Folder")) {
            if (!content.includes("tmbuild: No unit-test executable found.")) {
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
            }
        }
        if (content.includes("docgen:")) {
            // docgen error:
            const regex_doc = /docgen:(.*)cannot resolve(.*)$/gm;
            while ((m = regex_doc.exec(content)) !== null) {
                if (m.index === regex_doc.lastIndex) {
                    regex_doc.lastIndex++;
                }
                if (m.length >= 2) {
                    core.error(m[0].trim());
                    result += `error: ${m[0].trim()}\n`
                } else {
                    result += "docgen: failed\n";
                }
            }
            const regex_docgen_missing = /docgen:(.*)missing(.*)$/gm;
            while ((m = regex_docgen_missing.exec(content)) !== null) {
                if (m.index === regex_docgen_missing.lastIndex) {
                    regex_docgen_missing.lastIndex++;
                }
                if (m.length >= 2) {
                    core.warning(m[0].trim());
                    result += `warning: ${m[0].trim()}\n`
                } else {
                    result += "docgen: failed\n";
                }
            }
        }
        const regex_err = /error [aA-zZ][0-9]+:(.*)|(.*)error:(.*)|(.*)Error:(.*)|(.*)error :(.*)|(.*)Error :(.*)/gm;
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
        return result;
    } catch {
        return "[tmbuild-action] error parsing error!\n";
    }
}

exports.parseForError = parseForError;

function parseForWarnings(content) {
    try {
        let result = "";
        const regex_war = /warning [aA-zZ][0-9]+:(.*)|(.*)warning:(.*)|(.*)Warning:(.*)|(.*)warning :(.*)|(.*)Warning :(.*)/gm;
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
        return result;
    } catch {
        return "[tmbuild-action] error parsing warnings!\n";
    }
}


exports.parseForWarnings = parseForWarnings;


async function hash(file) {
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
        if (!fs.existsSync(file)) throw new Error(`Error: Could not find ${file}`);
        await exec.exec(`git hash-object ${file}`, [], options);
        return myOutput;
    } catch (e) {
        core.warning(`[tmbuild-action] There was an error with git hash-object ${file}`);
        throw new Error(e.message);
    }
}
exports.hash = hash;
