// Original Codegen -> shared SDK -> selected adapter -> real Hermes/Fabric/Godot.
// Bounded macOS arm64 Release experiment; not RN ecosystem/ABI certification.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateCodegen, verifyCodegen} from './codegen.mjs';
import {verifyNativeSdk} from './native-sdk.mjs';
import {preflightAdapters} from './adapter-manifest.mjs';
import {ensureGodotBinary} from './godot-binary.mjs';
const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value,null,2)+'\n');
function cmakePath(value) {
  if (/[";$\r\n]/.test(value)) throw new Error('E_ADAPTER_TEST_PATH: unsupported CMake path');
  return value.replaceAll('\\','/');
}
async function check({sdk, out, capture, cmake}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Requires macOS arm64');
  sdk = fs.realpathSync(sdk); verifyNativeSdk(sdk);
  out = path.resolve(out);
  const relative = path.relative(path.join(root,'build'),out);
  if (!relative || path.isAbsolute(relative) || relative==='..' || relative.startsWith('../')) throw new Error('Use a fresh child under build/');
  if (fs.existsSync(out)) throw new Error('Preserve existing witness output');
  const parent = fs.realpathSync(path.dirname(out));
  if (parent !== path.dirname(out)) throw new Error('Output parent must be canonical');
  fs.mkdirSync(out); fs.mkdirSync(path.join(out,'logs'));
  const inputs = ['scripts/adapter-runtime-check.mjs','scripts/pack-addon.mjs','sdk/toolchain/build.mjs',
    'sdk/toolchain/adapter-plugin.mjs','sdk/toolchain/project-resolution.mjs','sdk/toolchain/project-config.mjs',
    'sdk/toolchain/project-typecheck.mjs','sdk/toolchain/native-typecheck.mjs',
    'sdk/toolchain/native-compiler.mjs','sdk/toolchain/platform-plugin.mjs','sdk/toolchain/asset-plugin.mjs',
    'sdk/toolchain/platform-resolution.mjs','scripts/codegen.mjs','scripts/codegen-contract.mjs','scripts/adapter-manifest.mjs',
    ...fs.readdirSync(path.join(root,'tests/adapters/package')).map(name=>'tests/adapters/package/'+name),
    'tests/adapters/consumer/ui/index.tsx','tests/adapters/consumer/validation.gd','tests/adapters/consumer/main.tscn',
    'tests/adapters/consumer/tsconfig.json','sdk/addon/application_node.gd'];
  const report = {format:'godot-fabric.experimental-adapter-runtime-acceptance/v1',checkedAt:new Date().toISOString(),
    sourceSha256:Object.fromEntries(inputs.map(file=>[file,hash(path.join(root,file))])),
    sdkManifestSha256:hash(path.join(sdk,'manifest.json')),stages:[],passed:false,
    nativeAdapterLinked:false,componentMounted:false,vmCreated:false,godotEngineStarted:false,abiCertified:false};
  const save = () => write(path.join(out,'report.json'),report);
  function run(label, command, args, env=process.env) {
    const result = spawnSync(command,args,{cwd:root,encoding:'utf8',env,timeout:180000,maxBuffer:16*1024*1024});
    const log = path.join(out,'logs',label+'.log');
    fs.writeFileSync(log,JSON.stringify([command,...args])+'\n\n'+(result.stdout??'')+(result.stderr??''));
    report.stages.push({label,exitCode:result.status,log:path.relative(out,log),sha256:hash(log)});save();
    if (result.error || result.status!==0) throw new Error(label+' failed; see '+log);
    return (result.stdout??'')+(result.stderr??'');
  }
  try {
    const project = path.join(out,'project');
    fs.cpSync(path.join(root,'tests/adapters/consumer'),project,{recursive:true});
    const addon = path.join(project,'addons/godot_fabric');
    run('pack-addon',process.execPath,[path.join(root,'scripts/pack-addon.mjs'),addon,'--native-sdk',sdk]);
    const pkg = path.join(project,'node_modules/@godot-fabric/adapter-fixture');
    fs.mkdirSync(path.dirname(pkg),{recursive:true});
    fs.cpSync(path.join(root,'tests/adapters/package'),pkg,{recursive:true});
    fs.writeFileSync(path.join(project,'node_modules/.gdignore'),'');
    const combination = read(path.join(sdk,'native-combination.json'));
    const generated = path.join(pkg,'generated');
    const generation = {root:pkg,specs:['BadgeNativeComponent.ts','NativeExternalProbe.ts'],
      libraryName:'AdapterFixture',out:generated,nativeCombination:combination};
    generateCodegen(generation);verifyCodegen(generation);
    const harness = path.join(out,'harness');fs.mkdirSync(harness);
    const lib = path.join(pkg,'lib');fs.mkdirSync(lib);
    const componentDir = path.join(generated,'cpp/react/renderer/components/AdapterFixture');
    const cpp = ['ComponentDescriptors','EventEmitters','Props','ShadowNodes','States'].map(name=>path.join(componentDir,name+'.cpp'));
    cpp.push(path.join(pkg,'adapter.cpp'));
    fs.writeFileSync(path.join(harness,'CMakeLists.txt'),[
      'cmake_minimum_required(VERSION 3.31)','project(external_adapter_runtime LANGUAGES CXX)',
      'find_package(GodotFabricNativeSDK CONFIG REQUIRED PATHS "'+cmakePath(path.join(sdk,'cmake'))+'" NO_DEFAULT_PATH)',
      'add_library(adapter_fixture SHARED\n'+cpp.map(file=>'  "'+cmakePath(file)+'"').join('\n')+')',
      'target_include_directories(adapter_fixture PRIVATE "'+cmakePath(path.join(generated,'cpp'))+'")',
      'set_target_properties(adapter_fixture PROPERTIES LIBRARY_OUTPUT_DIRECTORY "'+cmakePath(lib)+'")',
      'godot_fabric_configure_adapter(adapter_fixture HOST_RUNTIME_DIR "'+cmakePath(path.relative(lib,path.join(addon,'native')))+'")','',
    ].join('\n'));
    const client = path.join(out,'client');
    run('configure-adapter',cmake,['-S',harness,'-B',client,'-G','Unix Makefiles','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_OSX_ARCHITECTURES=arm64','-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0']);
    run('compile-link-adapter',cmake,['--build',client,'--parallel','4']);
    report.nativeAdapterLinked = true;
    const library = path.join(lib,'libadapter_fixture.dylib');
    report.adapterLibrarySha256 = hash(library);
    const linkFile = path.join(client,'CMakeFiles/adapter_fixture.dir/link.txt');
    const linkCommand = fs.readFileSync(linkFile,'utf8');
    if (/\.a(?:\s|"|$)/.test(linkCommand) || !linkCommand.includes('-undefined') || !linkCommand.includes('fabric_godot.dylib'))
      throw new Error('Adapter must link the shared host strictly, without archives');
    report.linkCommandSha256 = hash(linkFile);
    run('adapter-dependencies','/usr/bin/otool',['-L',library]);
    const manifest = {format:'godot-fabric.experimental-adapter/v1',id:'RuntimeFixture',entryPoint:'godot_fabric_adapter_init_v1',
      library:{path:'lib/libadapter_fixture.dylib',sha256:hash(library)},nativeCombination:combination,
      codegenManifest:{path:'generated/manifest.json',sha256:hash(path.join(generated,'manifest.json'))},
      components:['ExternalBadge'],modules:['ExternalProbe'],dependsOn:[]};
    write(path.join(pkg,'adapter.json'),manifest);
    await preflightAdapters({adapters:[{packageRoot:pkg}],nativeCombination:combination});
    const sdkNode = path.join(addon,'toolchain/node/bin/node');
    const env = {...process.env,PATH:'/usr/bin:/bin',NODE_PATH:''};
    run('build-selected-specs',sdkNode,[path.join(addon,'toolchain/build.mjs'),project,'res://ui/index.tsx','res://.godot_fabric/app.js'],env);
    const packet = path.join(project,'.godot_fabric/app.js.adapters.json');
    const bundleReport = read(path.join(project,'.godot_fabric/build-report.json'));
    if (read(packet).adapters.length!==1 || bundleReport.adapterSelection.specs!==2) throw new Error('Original specs not paired with the bundle');
    report.selectionSha256 = hash(packet);report.bundleSha256 = bundleReport.sha256;
    // Discover GDExtension classes at startup, before the official 4.7.2
    // editor scan. No resource/import cache is copied from the SDK checkout.
    fs.mkdirSync(path.join(project,'.godot'),{recursive:true});
    fs.writeFileSync(path.join(project,'.godot/extension_list.cfg'),'res://addons/godot_fabric/fabric.gdextension\n');
    const godot = await ensureGodotBinary();
    run('godot-import',godot,['--path',project,'--headless','--editor','--quit'],env);
    const lanes = [
      {name:'headless',checks:35},
      {name:'external-appearance',checks:5,args:['--external-appearance']},
      ...['reentrant-stop','reentrant-raf','reentrant-timer'].map(name =>
        ({name,checks:name==='reentrant-stop'?8:9,args:['--'+name]})),
      ...['root-unmount-resize','root-unmount-pressed','root-unmount-raf','root-unmount-timer','root-remount-resize'].map(name =>
        ({name,checks:name==='root-remount-resize'?21:name.endsWith('-raf')||name.endsWith('-timer')?18:17,args:['--'+name]})),
      {name:'root-free-resize',checks:17,args:['--root-free-resize']},
      {name:'root-owner-switch-resize',checks:18,args:['--root-owner-switch-resize']},
      {name:'root-stale-core-owner-switch-resize',checks:21,args:['--root-stale-core-owner-switch-resize']},
      ...(capture?[
        {name:'graphical',checks:37,capture:true,stages:['initial','updated']},
        {name:'root-unmount-graphical',checks:21,capture:true,args:['--root-unmount-resize'],stages:['root-initial','root-unmounted']},
        {name:'root-remount-graphical',checks:25,capture:true,args:['--root-remount-resize'],stages:['root-initial','root-remounted']},
        {name:'root-owner-switch-graphical',checks:22,capture:true,args:['--root-owner-switch-resize'],stages:['root-initial','root-owner-switched']},
      ]:[]),
    ];
    for (const lane of lanes) {
      const args = ['--path',project,...(!lane.capture?['--headless']:[]),'--','--validate',
        ...(lane.capture?['--capture']:[]),...(lane.args??[])];
      const log = run('godot-'+lane.name,godot,args,env);
      if (/SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|ADAPTER_CHECK_FAILED|FABRIC_ERROR/.test(log) || !log.includes('ADAPTER_RUNTIME_OK:'))
        throw new Error('Godot '+lane.name+' failed runtime acceptance; retained logs');
      const actual = read(path.join(project,'adapter-report.json'));
      if (actual.checks.length!==lane.checks || !actual.checks.every(check=>check.passed)) throw new Error('Incomplete adapter runtime report: '+lane.name);
      write(path.join(out,lane.name+'.json'),actual);
      report[lane.name] = {checks:actual.checks.length,sha256:hash(path.join(out,lane.name+'.json')),displayServer:actual.displayServer};
      report.vmCreated=true;report.godotEngineStarted=true;report.componentMounted=true;
      for (const stage of lane.stages??[]) fs.copyFileSync(path.join(project,'adapter-'+stage+'.png'),path.join(out,stage+'.png'));
    }
    verifyCodegen(generation);verifyNativeSdk(sdk);
    if (hash(library)!==report.adapterLibrarySha256 || hash(packet)!==report.selectionSha256 || hash(path.join(sdk,'manifest.json'))!==report.sdkManifestSha256)
      throw new Error('Runtime artifacts changed during acceptance');
    for (const [file, digest] of Object.entries(report.sourceSha256)) if (hash(path.join(root,file))!==digest) throw new Error('Acceptance source changed: '+file);
    report.passed = true;
    console.log(JSON.stringify({passed:true,nativeAdapterLinked:true,componentMounted:true,headless:report.headless,
      reentrantStop:report['reentrant-stop'],reentrantRaf:report['reentrant-raf'],reentrantTimer:report['reentrant-timer'],
      rootRetirement:Object.fromEntries(lanes.filter(lane=>lane.name.startsWith('root-')).map(lane=>[lane.name,report[lane.name]])),
      externalAppearance:report['external-appearance'],graphical:report.graphical??null,abiCertified:false}));
  } catch(error) {report.error=error.message;throw error;}
  finally {save();}
}
try {
  const values={};let capture=false;
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--capture') {capture=true;continue;}
    if(!['--sdk','--out','--cmake'].includes(args[i])||!args[i+1]||values[args[i]]) throw new Error('Use --sdk <verified SDK> --out <new build child> [--capture] [--cmake <binary>]');
    values[args[i]]=args[++i];
  }
  if(!values['--sdk']||!values['--out']) throw new Error('Use --sdk and --out');
  await check({sdk:values['--sdk'],out:values['--out'],capture,cmake:fs.realpathSync(values['--cmake']??path.join(root,'.deps/python/bin/cmake'))});
} catch(error) {console.error(error.message);process.exitCode=1;}
