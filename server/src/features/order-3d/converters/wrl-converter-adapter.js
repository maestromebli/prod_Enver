/** VRML (.wrl) з Базіс — перегляд без конвертації (як GLB). */
export const wrlConverterAdapter = {
  canHandle(fileType) {
    return fileType === "wrl";
  },

  async convert(input) {
    return {
      status: "READY",
      webModelStoragePath: input.originalStoragePath,
      errorMessage: "VRML-збірка з Базіс (.wrl)"
    };
  }
};
