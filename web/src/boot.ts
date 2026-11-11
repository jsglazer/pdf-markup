import { configureExcalidrawAssetPath } from "./platform/assetPath";

// Set the local asset path BEFORE Excalidraw's module code runs, then load the app.
configureExcalidrawAssetPath(window, document.baseURI);
void import("./main");
