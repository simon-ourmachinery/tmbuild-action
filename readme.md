# tmbuild-action

A GitHub action to build **The Machinery**'s one click build tool as well as the engine itself. This action will cache all depencies as well as the build tool itself if required. It also allowes to create build artifacts and to pack the engine at the end.

## Features
- Will report errors and warnings via annotations
- Can caches the dependencies and tmbuild
- You can build only tmbuild
- You can build the Engine
- You can define a repositry for the engines dependencies
- You can package the engine
- You can store the build/package artifacts


## Examples:

*How to build:*

```yaml
    - name: run tmbuild via action
      uses: ./tmbuild-action
      id: tmbuild
      with:
        buildconfig: Debug
```

*How to package:*

```yaml
    - name: Package Engine with beta-package.json setting
      uses: ./tmbuild-action
      id: tmbuild
      with:
        artifact: true
        package: beta-package.json
```

## Variable overview:

### Inputs

- Build Settings:
  - `clang: [true|false] (default: false)` will build on Windows (only) with clang
  - `buildconfig: [Debug|Release] (default: Debug)` 
  - `build: [true|false] (default: true)` If set to true than it will build the engine.
  - `package: [string value of a package.json] (default: not set)` If set with a valid package file the action will package the engine
  - `buildtmbuild: [true|false] (default: false)` Will build tmbuild. If `useCache: true` and there is *no* tmbuild in the cache it will build tmbuild in any case and cache it. If no cache is being used there will be an error
- Config optionals:
  - `libjsonpath: [string path to engines lib json] (default: ./)`
  - `libpath: [string path to where the dependencies shall be stored] (default: ./lib` * should be the same value as the TM_LIB_DIR*
  - `repo: [string url to repo] (default: tm default repo)` Should be a valid HTTP(S) domain
- Cache settings:
  - `useCache: [true|false] (default: true)` determines if the cache shall be used. The action will only cache the dependeices in `$libpath` and `tmbuild` itself
  - `cacheLibs: [true|false] (default: true)` determines if the `$libpath` shall be cached or not
  - `cacheVersion: [version number n.n.n] (default: 1.0.0)` If changed the action will update the cache and create new caches. This should be used if `$libjson` has changed or tmbuild has changed.
- Artifacts settings:
  - `artifacts: [true|false] (default: false)` stores build artifacts: `bin/*` and `build/*` (excluding packages)
  - `packageArtifact: [true|false] (default: false)` stores the artifacts of a package.