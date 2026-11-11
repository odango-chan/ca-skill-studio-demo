// Theia browser-only native OPFS binding. The regular filesystem module
// supplies OPFSFileSystemProvider; this module wraps its FileSystemProvider
// binding without changing the physical browser storage or workspace URIs.
import {ContainerModule} from "@theia/core/shared/inversify";
import {FileSystemProvider,FileSystemProviderErrorCode,FilePermission,
  createFileSystemProviderError} from "@theia/filesystem/lib/common/files";
import {OPFSFileSystemProvider} from "@theia/filesystem/lib/browser-only/opfs-filesystem-provider";
import {protectOpfsProvider} from "./protected-opfs.mjs";

const PROTECTED_OPFS=Symbol("SkillStudioProtectedOPFS");
export default new ContainerModule((bind,_unbind,isBound,rebind)=>{
  bind(PROTECTED_OPFS).toDynamicValue(ctx=>protectOpfsProvider(
    ctx.container.get(OPFSFileSystemProvider),{
      deny:message=>{throw createFileSystemProviderError(
        message,FileSystemProviderErrorCode.NoPermissions);},
      readonlyPermission:FilePermission.Readonly
    }
  )).inSingletonScope();
  if(isBound(FileSystemProvider))rebind(FileSystemProvider).toService(PROTECTED_OPFS);
  else bind(FileSystemProvider).toService(PROTECTED_OPFS);
});
