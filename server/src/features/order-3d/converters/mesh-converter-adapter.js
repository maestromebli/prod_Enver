import { CONVERTER_STUB_MESSAGE } from "./model-converter.js";

/** OBJ/STL — майбутній worker; поки stub. */
export const meshConverterAdapter = {
  canHandle(fileType) {
    return fileType === "obj" || fileType === "stl";
  },

  async convert() {
    return {
      status: "NEED_MANUAL_CHECK",
      errorMessage: CONVERTER_STUB_MESSAGE
    };
  }
};
