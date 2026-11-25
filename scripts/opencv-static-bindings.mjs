// Inserted into the pinned Emscripten bundle, where these binding helpers live.
// The WebAssembly module and its OpenCV implementation remain byte-identical.
export function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
  if (argTypes.length < 2) throwBindingError('Invalid binding signature');
  const method = argTypes[1] !== null && classType !== null;
  const stackNeeded = argTypes.slice(1).some(type => type && type.destructorFunction === undefined);
  const arity = argTypes.length - 2;
  function invoke(...args) {
    if (args.length !== arity) throwBindingError(humanName + ' expects ' + arity + ' arguments');
    const stack = stackNeeded ? [] : null;
    const wire = [cppTargetFunc];
    if (method) wire.push(argTypes[1].toWireType(stack, this));
    for (let i = 0; i < args.length; i++) wire.push(argTypes[i + 2].toWireType(stack, args[i]));
    const result = cppInvokerFunc(...wire);
    if (stack) runDestructors(stack);
    else {
      for (let i = method ? 1 : 2; i < argTypes.length; i++) {
        const destroy = argTypes[i].destructorFunction;
        if (destroy) destroy(wire[method ? i : i - 1]);
      }
    }
    if (argTypes[0].name !== 'void') return argTypes[0].fromWireType(result);
  }
  Object.defineProperties(invoke, { name: { value: makeLegalFunctionName(humanName) }, length: { value: arity } });
  return invoke;
}

export function __emval_get_method_caller(argCount, argTypes) {
  const [resultType, ...types] = __emval_lookupTypes(argCount, argTypes);
  return __emval_addMethodCaller(function (handle, name, destructors, pointer) {
    const args = [];
    for (const type of types) {
      args.push(type.readValueFromPointer(pointer));
      pointer += type.argPackAdvance;
    }
    const result = handle[name](...args);
    for (const [i, type] of types.entries()) if (type.deleteObject) type.deleteObject(args[i]);
    if (!resultType.isVoid) return resultType.toWireType(destructors, result);
  });
}
