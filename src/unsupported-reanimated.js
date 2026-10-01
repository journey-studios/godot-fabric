// O React pode repetir um render que falhou. O cache CommonJS não deve trocar
// a falha inicial por undefined em uma segunda leitura do módulo.
module.exports = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "Godot platform does not implement Reanimated/worklets or NativeWind animations",
      );
    },
  },
);
