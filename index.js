// GitHub dependencies:
const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');


// internal dependencies
const utils = require("./internal/utils");
const tools = require("./internal/tools");
const build = require("./internal/build");
const cache = require("./internal/cache");
const os = require("os");
const fs = require('fs');

async function build_tmbuild(buildconfig, ending) {
    await build.make();
    await build.build_tmbuild();
    await utils.cp(`./bin/${buildconfig}/tmbuild${ending}`, `./bin/tmbuild/${buildconfig}`);
}

(async () => {
    try {
        const canBuild = utils.getInput("build") === 'true';
        const buildtmbuild = utils.getInput("buildtmbuild") === 'true';
        const libpath = utils.getInput("libpath");
        const buildconfig = utils.getInput("buildconfig");
        // cache settings:
        const cacheLibs = utils.getInput("cacheLibs") === 'true';
        const useCache = utils.getInput("useCache") === 'true';
        const cacheVersion = utils.getInput("cacheVersion");
        const ending = (os.platform() == "win32") ? ".exe" : "";
        // if true package and cache at the end libs and tmbuild      
        let libCacheIsDirty = false;
        let tmbuildCacheIsDirty = false;
        // artifact
        const packageArtifact = utils.getInput("packageArtifact") === 'true';
        // downloads the cache and if cache does not exist it will install it:
        if (useCache) {
            // download cached libs (dependencies)
            if (cacheLibs) {
                try {
                    core.startGroup("[tmbuild-action] get cached dependencies");
                    await cache.get("libs", cacheVersion);
                    core.endGroup();
                } catch (e) {
                    utils.info(e.message);
                    await tools.install("bearssl");
                    await tools.install("premake5");
                    if (os.platform() != "win32") {
                        const libjson = utils.parseLibsFile(utils.getInput("libjsonpath"));
                        const toolObject = utils.getLib(libjson, "premake5");
                        const toolname = toolObject.lib;
                        await tools.chmod(`${libpath}/${toolname}/premake5`);
                    }
                    libCacheIsDirty = true;
                }
            }
            // downloads cached tmbuild version
            if (!buildtmbuild) {
                try {
                    core.startGroup(`[tmbuild-action] get cached tmbuild-${buildconfig}`);
                    await cache.get(`tmbuild`, cacheVersion);
                    core.endGroup();
                } catch (e) {
                    utils.info(e.message);
                    await build_tmbuild(buildconfig, ending);
                    tmbuildCacheIsDirty = true;
                }
            }
        } else {
            await tools.install("bearssl");
            await tools.install("premake5");
            if (os.platform() != "win32") {
                const libjson = utils.parseLibsFile(utils.getInput("libjsonpath"));
                const toolObject = utils.getLib(libjson, "premake5");
                const toolname = toolObject.lib;
                await tools.chmod(`${libpath}/${toolname}/premake5`);
            }
        }

        if (useCache && tmbuildCacheIsDirty) {
            await cache.set(`./bin/tmbuild/${buildconfig}`, `tmbuild`, cacheVersion);
        }

        if (buildtmbuild && !tmbuildCacheIsDirty) {
            await build_tmbuild(buildconfig, ending);
        }

        if (canBuild) {
            await build.tmbuild(utils.getInput("package"));
        }

        if (useCache && libCacheIsDirty) {
            await cache.set(libpath, `libs`, cacheVersion);
        }

        const currentDate = new Date();
        const date = currentDate.getDate();
        const month = currentDate.getMonth();
        const year = currentDate.getFullYear();
        const now = `${date}-${month}-${year}`;

        if (utils.getInput("artifact") === 'true') {
            core.startGroup(`[tmbuild-action] store artifacts`);
            await tools.storeFolder(`bin-${buildconfig}-${now}`, `./bin/${buildconfig}`);
            await tools.storeFolder(`build-${buildconfig}-${now}`, `./build`);
            core.endGroup();
        }

        if (utils.getInput("package").length != 0 && packageArtifact) {
            core.startGroup(`[tmbuild-action] store package artifacts`);
            await tools.storeFile(`package-${buildconfig}-${now}`, `./build/*.zip`);
            core.endGroup()
        } else {
            utils.info("info: packaged project but did not store the artifacts because `packageArtifact` is false");
        }

    } catch (e) {
        core.setFailed(e.message);
    }
})();