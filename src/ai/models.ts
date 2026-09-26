import { Directory, File, Paths } from 'expo-file-system';
import { MODELS, type ModelKind } from './catalog';

export { MODELS, type ModelKind };

const modelDir = () => new Directory(Paths.document, 'models');

export function modelFile(kind: ModelKind): File {
  return new File(modelDir(), MODELS[kind].file);
}

export function isDownloaded(kind: ModelKind): boolean {
  return modelFile(kind).exists;
}

export async function download(kind: ModelKind): Promise<void> {
  const dir = modelDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const target = modelFile(kind);
  if (target.exists) return;
  await File.downloadFileAsync(MODELS[kind].url, target);
}
