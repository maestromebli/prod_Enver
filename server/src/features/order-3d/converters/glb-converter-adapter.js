/** GLB/GLTF вже web-формат — конвертація не потрібна. */
export const glbConverterAdapter = {
  canHandle(fileType) {
    return fileType === "glb" || fileType === "gltf";
  },

  async convert(input) {
    return {
      status: "READY",
      webModelStoragePath: input.originalStoragePath
    };
  }
};
