import { registerSurface } from "../surfaces";
import { importRecordExtras } from "./surface";

export function registerImportSurface(): void {
  registerSurface({ featureKey: "import_batch", recordExtras: importRecordExtras });
}
