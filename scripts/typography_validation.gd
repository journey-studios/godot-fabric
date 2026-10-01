extends "res://scripts/pointer_validation.gd"

var states := {}

func _ready() -> void:
  get_window().size = Vector2i(900, 980)
  surface = FabricSurface.new()
  surface.set_meta("scenario", "typography")
  if OS.get_cmdline_user_args().has("--validate"):
    surface.set_meta("validation_input_device", 1001)
  add_child(surface)
  await wait_native("ty-title")
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  await frames(5)
  var title := node("ty-title")
  var rich := node("ty-rich")
  var description := node("ty-description")
  var creates: int = data().creates
  verify(data().errors.is_empty(), "Fabric original cria Paragraph/Text/RawText no Hermes sem erro")
  verify(title.kind == "paragraph" and rich.kind == "paragraph", "Text público monta parágrafos originais do Fabric")
  verify(title.runs[0].fontFamily == "NotoSans" and title.runs[0].fontWeight == 700 and title.runs[0].fontSize == 18, "NativeWind font-sans/font-bold/text-xl usa fonte variável registrada")
  verify(title.lineMetrics[0].height == 24.5 and title.height == 25, "leading-7 mede 24.5 e Yoga arredonda a altura para 25")
  verify(rich.nativeText.contains("0 itens") and rich.runs.size() >= 5, "Fabric agrega RawText e Text aninhado em um único parágrafo")
  var inherited := false
  var colored := false
  for run in rich.runs:
    inherited = inherited or (run.fontWeight == 700 and run.fontFamily == "NotoSans" and run.fontSize == 14 and run.lineHeight == 21)
    colored = colored or run.color == "6ee7b7ff"
  verify(inherited and colored, "Span herda família/tamanho/leading e sobrescreve peso/cor")
  verify(node("ty-left").lineMetrics[0].x == 0 and node("ty-center").lineMetrics[0].x > 0 and node("ty-right").lineMetrics[0].x > node("ty-center").lineMetrics[0].x, "Alinhamentos alteram origem dos glifos no mesmo frame")
  verify(node("ty-bold").measuredWidth > node("ty-regular").measuredWidth, "Peso real altera largura medida, sem negrito sintético")
  verify(node("ty-limited").lines > 2 and node("ty-limited").visibleLines == 2 and node("ty-limited").height == 42 and node("ty-limited").ellipses == 1, "numberOfLines limita medida a duas linhas e gera reticências nativas")
  verify(node("ty-spacing").measuredWidth > node("ty-regular").measuredWidth + 20, "letterSpacing altera os avanços reais dos glifos")
  verify(node("ty-break").lines == 3 and node("ty-break").height == 63 and node("ty-empty").lines == 1 and node("ty-empty").height == 21, "Texto vazio e newline final mantêm as linhas e leading declarados")
  verify_geometry("initial")
  await capture("initial")

  surface.evaluate("GodotApp.run('clip')")
  await wait_js("GodotApp.stats().clipped", 4)
  verify(node("ty-limited").ellipses == 0 and node("ty-limited").height == 42, "Mudar apenas ellipsizeMode atualiza medida e desenho do parágrafo")
  await capture("clip")
  surface.evaluate("GodotApp.run('limit', 1)")
  await wait_js("GodotApp.stats().limit === 1", 4)
  verify(node("ty-limited").visibleLines == 1 and node("ty-limited").height == 21, "Mudar apenas numberOfLines reduz a altura medida e desenhada")
  surface.evaluate("GodotApp.run('clip'); GodotApp.run('limit', 2)")
  await frames(4)
  verify(node("ty-limited").ellipses == 1 and node("ty-limited").height == 42, "Restaurar props de parágrafo recupera truncamento original")

  await mouse("start", at("ty-increment"))
  await mouse("end", at("ty-increment"))
  await wait_js("GodotApp.stats().count === 1", 4)
  verify(node("ty-rich").nativeText.contains("1 itens") and node("ty-rich").id == rich.id, "Estado do componente aninhado atualiza AttributedString sem remontar o parágrafo")
  await mouse("start", at("ty-change"))
  await mouse("end", at("ty-change"))
  await wait_js("GodotApp.stats().changed", 4)
  verify(node("ty-title").runs[0].fontFamily == "JetBrainsMono" and node("ty-title").runs[0].fontSize == 26 and node("ty-title").height == 35, "Trocar família/tamanho/leading invalida medida e desenho")
  verify(node("ty-description").height > description.height, "Layout cresce com fonte e leading maiores")
  verify(node("ty-title").id == title.id and node("ty-rich").id == rich.id and data().creates == creates and react().childMounts == 1, "Mudanças de estilos preservam identidade, hooks e Controls")
  verify_geometry("changed")
  await capture("changed")

  var wide := node("ty-description")
  await resize_window(Vector2i(620, 1100))
  verify(node("ty-description").height > wide.height and node("ty-description").lines > wide.lines, "Reduzir largura recalcula quebra e altura sem altura fixa")
  verify(node("ty-rich").nativeText.contains("1 itens") and react().childMounts == 1 and data().creates == creates, "Resize preserva estado do filho e não cria Controls extras")
  verify_geometry("narrow")
  await capture("narrow")
  await resize_window(Vector2i(900, 980))
  verify(node("ty-description").height == wide.height, "Restaurar largura remove a medida estreita do cache")
  surface.evaluate("GodotApp.run('clear')")
  await wait_js("GodotApp.stats().cleared", 4)
  var reset := node("ty-reset")
  verify(reset.runs[0].fontFamily == "" and reset.runs[0].fontWeight == 400 and reset.runs[0].fontSize == 18 and reset.runs[0].lineHeight == 0 and reset.lineMetrics[0].x == 0, "Remover classes restaura família/peso/leading/alinhamento padrão")
  surface.evaluate("GodotApp.run('change')")
  await wait_js("!GodotApp.stats().changed", 4)
  verify(node("ty-title").height == title.height and node("ty-title").runs[0].fontFamily == "NotoSans", "Reduzir fonte recupera exatamente o layout inicial")
  await wheel(at("ty-scroll"))
  verify(node("ty-scroll").scroll.y > 0, "Parágrafos medidos integram ScrollView e roda nativa")

  var expected := ["not registered", "Inline Controls", "tail or clip"]
  for index in range(3):
    surface.evaluate("GodotApp.run('fail', '%s')" % ["font", "inline", "mode"][index])
    await wait_js("GodotApp.stats().errors.length === %d" % (index + 1), 4)
    verify(react().errors[index].contains(expected[index]) and not node("ty-fallback").is_empty(), "Contrato recusa recurso não implementado antes do layout nativo: " + expected[index])
    surface.evaluate("GodotApp.run('fail', null)")
    await frames(4)
  verify(node("ty-fallback").is_empty() and data().errors.is_empty() and react().mounts == 1 and react().childMounts == 1 and react().count == 1, "ErrorBoundary recupera os três negativos sem perder estado nem causar erro do host")
  var before_stop := data()
  remove_child(surface)
  var stopped := data()
  var state := react()
  verify(stopped.stopped and stopped.nodes.is_empty() and stopped.creates == stopped.deletes and stopped.nativeTags == 0, "Saída destrói todos os parágrafos e Controls")
  verify(state.cleanups == 1 and state.childCleanups == 1 and not stopped.windowListener, "Saída executa cleanup do pai, filho e listener de janela")
  verify(state.environment.dimensions == 0 and state.environment.appearance == 0 and state.environment.appState == 0 and state.environment.reduceMotion == 0, "Saída remove subscriptions do NativeWind")
  verify(stopped.pendingTimers == 0 and stopped.pendingAnimationFrames == 0 and stopped.pointer.activeTouches == 0 and stopped.pointer.responder == 0 and stopped.errors.is_empty(), "Surface termina sem timers, responder ou erros")
  surface.free()
  save_report("typography", before_stop, stopped, state, {"nativeWind": "4.2.7", "states": states})

func verify_geometry(stage: String) -> void:
  var matches := true
  var measured := true
  for entry in data().nodes:
    matches = matches and abs(entry.width - entry.fabricWidth) < 1 and abs(entry.height - entry.fabricHeight) < 1
    if entry.kind == "paragraph":
      measured = measured and abs(entry.height - entry.measuredHeight) <= 1
  verify(matches and measured, "Yoga e desenho usam a mesma altura de parágrafo: " + stage)
  var description_control: Control = surface.find_child("ty-description", true, false)
  var after: Control = surface.find_child("ty-after", true, false)
  verify(after.get_global_rect().position.y >= description_control.get_global_rect().end.y, "Texto seguinte não sobrepõe descrição: " + stage)

func ink(image: Image, id: String) -> float:
  var control: Control = surface.find_child(id, true, false)
  var rect := Rect2i(control.get_global_rect())
  var value := 0.0
  for y in range(rect.position.y, rect.end.y):
    for x in range(rect.position.x, rect.end.x):
      var c := image.get_pixel(x, y)
      value += maxf(0, minf(c.r, minf(c.g, c.b)) - 0.06)
  return value

func capture(stage: String) -> void:
  states[stage] = data()
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(ink(image, "ty-title") > 100 and ink(image, "ty-description") > 100, "Parágrafos medidos desenham glifos reais: " + stage)
  var control: Control = surface.find_child("ty-rich", true, false)
  var rect := Rect2i(control.get_global_rect())
  var green := 0
  var amber := 0
  for y in range(rect.position.y, rect.end.y):
    for x in range(rect.position.x, rect.end.x):
      var c := image.get_pixel(x, y)
      green += int(c.g > 0.55 and c.g > c.r * 1.3 and c.g > c.b * 1.1)
      amber += int(c.r > 0.7 and c.r > c.b * 1.8 and c.g > 0.45)
  verify(green > 10 and amber > 10, "Pixels confirmam cores distintas dos spans herdados: " + stage)
  if stage == "initial":
    verify(ink(image, "ty-bold") > ink(image, "ty-regular") * 1.15, "Fonte variável bold desenha mais tinta que regular")
  verify(image.save_png("res://build/typography-" + stage + ".png") == OK, "Captura real salva: " + stage)
