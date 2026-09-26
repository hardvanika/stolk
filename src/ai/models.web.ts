import { desktop } from '../desktop/bridge';
import { MODELS, type ModelKind } from './catalog';

export { MODELS, type ModelKind };

/** Desktop: models live in the app's data folder (e.g. ~/.config/stolk/models). */
export function modelFile(kind: ModelKind): { uri: string } {
  return { uri: desktop().modelStat(MODELS[kind].file).path };
}

export function isDownloaded(kind: ModelKind): boolean {
  return desktop().modelStat(MODELS[kind].file).exists;
}

export async function download(kind: ModelKind): Promise<void> {
  await desktop().download(MODELS[kind].file, MODELS[kind].url);
}
