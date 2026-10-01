extends "res://scripts/pointer_validation.gd"

var states := {}

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  surface = FabricSurface.new()
  surface.set_meta("scenario", "nativewind")
  if OS.get_cmdline_user_args().has("--validate"):
    surface.set_meta("validation_input_device", 1001)
  add_child(surface)
  await wait_native("nw-card")
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  await frames(4)
  verify(data().errors.is_empty(), "NativeWind original inicializa no Hermes sem erro do host")
  verify(node("nw-card").get("appearance", {}).get("background") == "4f46e5ff", "Classe bg-indigo-600 pinta o Control real")
  verify(node("nw-root").width == 900 and node("nw-root").height == 680, "w-full/h-full usam a janela real")
  verify(node("nw-title").nativeFontSize == 28 and node("nw-title").appearance.textColor == "ffffffff", "Classe de texto chega ao font_size e font_color do Label")
  verify(node("nw-card").appearance.borderWidths == [2.0, 2.0, 2.0, 2.0] and node("nw-card").appearance.borderColor == "a5b4fcff", "Fabric e StyleBoxFlat aplicam bordas reais")
  verify(node("nw-card").appearance.cornerRadii == [16.0, 16.0, 16.0, 16.0], "rounded define os quatro cantos do StyleBoxFlat")
  verify(node("nw-title").x == 21 and node("nw-card").y == 0 and node("nw-theme").y > 0, "p-6 usa rem 14 do NativeWind e layout inicial em coluna")
  verify(node("nw-variable").appearance.background == "fbbf24ff", "vars e contexto originais resolvem variável herdada")
  verify(node("nw-inline").appearance.background == "2563ebff" and node("nw-important").appearance.background == "10b981ff", "Precedência original: inline e !important")
  verify(node("nw-clear").opacity == 0.5, "opacity-50 altera o modulate do Control")
  verify_geometry("initial")
  await capture("initial")

  var title := node("nw-title")
  var card := node("nw-card")
  var press_id: float = node("nw-press").id
  var creates: int = data().creates
  await mouse("start", at("nw-press"))
  verify(node("nw-press").appearance.background == "60a5faff" and react().count == 0, "active: muda a cor durante o PressIn original sem ativar o clique")
  await capture("pressed")
  await mouse("end", at("nw-press"))
  await wait_js("GodotApp.stats().count === 1", 4)
  await wait_color("nw-press", "2563ebff")
  verify(node("nw-press").appearance.background == "2563ebff" and node("nw-count").nativeText.ends_with("1"), "Release restaura cor e onPress rerenderiza texto")
  verify(node("nw-press").id == press_id and data().pointer.activeTouches == 0 and data().pointer.responder == 0, "Interop preserva Control e limpa o responder após clique")
  await mouse("start", at("nw-change"))
  await mouse("end", at("nw-change"))
  await wait_js("GodotApp.stats().changed", 4)
  verify(node("nw-card").appearance.background == "14b8a6ff" and node("nw-card").appearance.borderColor == "99f6e4ff", "Troca de classes altera background e borda no Control montado")
  verify(node("nw-variable").appearance.background == "34d399ff", "Mudança de vars atualiza o descendente pelo interop original")
  verify(node("nw-title").nativeFontSize == 32 and node("nw-title").height > title.height, "Classe de fonte invalida medição nativa e altura Yoga")
  verify(node("nw-card").id == card.id and node("nw-title").id == title.id and data().creates == creates, "Re-renders de classes preservam identidade sem alocar Controls")
  verify_geometry("changed")
  surface.evaluate("GodotApp.run('clear')")
  await wait_js("GodotApp.stats().cleared", 4)
  verify(node("nw-clear").appearance.background == "00000000" and node("nw-clear").appearance.borderWidths == [0.0, 0.0, 0.0, 0.0] and node("nw-clear").appearance.cornerRadii == [0.0, 0.0, 0.0, 0.0] and node("nw-clear").opacity == 1, "Remover classes limpa background, bordas, raios e opacidade")
  surface.evaluate("GodotApp.run('theme', 'dark')")
  await frames(5)
  verify(node("nw-theme").appearance.background == "1e293bff", "dark: reage ao tema manual publicado por Appearance")
  await resize_window(Vector2i(1200, 800))
  verify(node("nw-card").y == 0 and node("nw-theme").y == 0 and node("nw-theme").x > node("nw-card").x, "lg: troca coluna por linha na dimensão real da surface")
  verify(node("nw-card").id == card.id and data().creates == creates and react().count == 1, "Resize responsivo preserva estado React e Controls")
  verify_geometry("wide")
  await capture("wide-dark-changed")
  await resize_window(Vector2i(700, 760))
  verify(node("nw-theme").y > node("nw-card").y and node("nw-theme").x == 0, "Diminuir viewport restaura a coluna sem media query presa")
  verify_geometry("narrow")
  await capture("narrow")

  surface.evaluate("GodotApp.run('unsupported')")
  await wait_js("GodotApp.stats().errors.length === 1", 4)
  verify(react().errors[0].contains("style textShadowRadius") and not node("unsupported-fallback").is_empty(), "Style sem adapter falha no ErrorBoundary em vez de sumir silenciosamente")
  surface.evaluate("GodotApp.run('recover')")
  await frames(4)
  surface.evaluate("GodotApp.run('animation')")
  await wait_js("GodotApp.stats().errors.length === 2", 4)
  verify(react().errors[1].contains("Reanimated/worklets"), "animate-spin falha explicitamente na fronteira Reanimated ausente")
  surface.evaluate("GodotApp.run('recover'); GodotApp.run('clear'); GodotApp.run('change'); GodotApp.run('theme', 'light')")
  await frames(5)
  verify(node("unsupported-fallback").is_empty() and node("nw-card").appearance.background == "4f46e5ff" and node("nw-theme").appearance.background == "f1f5f9ff", "Árvore funcional recupera após negativos e restaura estilos")
  verify(node("nw-title").nativeFontSize == 28 and node("nw-title").height == title.height, "Reduzir fonte remove medição anterior maior")
  verify(data().errors.is_empty() and react().mounts == 1, "Negativos capturados não viram erro do host nem remontam a aplicação")
  await resize_window(Vector2i(900, 680))
  var before_stop := data()
  remove_child(surface)
  var stopped := data()
  var state := react()
  verify(stopped.stopped and stopped.nodes.is_empty() and stopped.creates == stopped.deletes and stopped.nativeTags == 0, "Saída da cena destrói todos os Controls registrados")
  verify(state.cleanups == 1 and state.subscribers == 0 and not stopped.windowListener, "Saída limpa effects React e callback nativo de dimensões")
  verify(state.environment.dimensions == 0 and state.environment.appearance == 0 and state.environment.appState == 0 and state.environment.reduceMotion == 0, "Saída remove subscriptions globais criadas pelo interop")
  verify(stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.pointer.activeTouches == 0 and stopped.pointer.responder == 0 and stopped.errors.is_empty(), "Surface termina sem timers, frames, responder ou erros")
  surface.free()
  save_report("nativewind", before_stop, stopped, state, {"nativeWind": "4.2.7", "cssInterop": "0.2.7", "tailwind": "3.4.17", "states": states})

func verify_geometry(stage: String) -> void:
  var matches := true
  var visible := true
  for entry in data().nodes:
    matches = matches and abs(entry.width - entry.fabricWidth) < 1 and abs(entry.height - entry.fabricHeight) < 1
    if entry.kind in ["text", "paragraph"]:
      visible = visible and entry.visibleLines == entry.lines
  verify(matches, "Frames Fabric correspondem aos Controls: " + stage)
  verify(visible, "Labels exibem todas as linhas medidas: " + stage)

func wait_color(id: String, expected: String) -> void:
  var deadline := Time.get_ticks_msec() + 5000
  while node(id).appearance.background != expected and Time.get_ticks_msec() < deadline:
    await frames(1)
  verify(node(id).appearance.background == expected, "Cor nativa após PressOut: " + id)

func capture(stage: String) -> void:
  states[stage] = data()
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  var card_control: Control = surface.find_child("nw-card", true, false)
  var card_rect := card_control.get_global_rect()
  var sample := Vector2i(card_rect.get_center().x, card_rect.end.y - 10)
  var expected := Color("4f46e5") if stage in ["initial", "pressed"] else Color("14b8a6")
  verify(image.get_pixelv(sample).is_equal_approx(expected), "Pixel da View corresponde à classe compilada: " + stage)
  if stage == "pressed":
    var press_control: Control = surface.find_child("nw-press", true, false)
    var press_rect := press_control.get_global_rect()
    verify(image.get_pixelv(Vector2i(press_rect.end.x - 10, press_rect.get_center().y)).is_equal_approx(Color("60a5fa")), "Pixel pressionado corresponde ao active: original")
  var status := image.save_png("res://build/nativewind-" + stage + ".png")
  verify(status == OK, "Captura real salva: " + stage)
