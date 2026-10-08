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
  var lines := node("ty-lines")
  var cancel := node("ty-cancel")
  verify(node("ty-italic").runs[0].fontStyle == "italic" and node("ty-italic").runs[0].syntheticItalic and node("ty-upright").runs[0].fontStyle == "normal"
    and node("ty-italic").measuredWidth == node("ty-upright").measuredWidth and node("ty-italic").lineMetrics == node("ty-upright").lineMetrics,
    "Itálico sintético inclina os glifos sem mudar avanço, largura nem quebras")
  verify(lines.decorations.map(func(row: Dictionary) -> Array: return [int(row.run), row.kind, row.color]) == [[2, "underline", "ffffffff"], [4, "line-through", "fb7185ff"], [6, "underline", "f97316ff"]]
    and lines.runs[0].fontStyle == "italic",
    "Sublinhado, tachado e decoração colorida (NativeWind) desenham uma linha por trecho, na cor do texto ou na de textDecorationColor")
  verify(cancel.decorations.map(func(row: Dictionary) -> Array: return [int(row.run), row.kind, row.color]) == [[0, "underline", "38bdf8ff"], [2, "underline", "38bdf8ff"]],
    "Um span com textDecorationLine none cancela o sublinhado do pai e o texto seguinte volta a ser sublinhado")
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

  var expected := ["not registered", "Inline Controls", "tail or clip", "textDecorationStyle dotted: only solid"]
  for index in range(4):
    surface.evaluate("GodotApp.run('fail', '%s')" % ["font", "inline", "mode", "dotted"][index])
    await wait_js("GodotApp.stats().errors.length === %d" % (index + 1), 4)
    verify(react().errors[index].contains(expected[index]) and not node("ty-fallback").is_empty(), "Contrato recusa recurso não implementado antes do layout nativo: " + expected[index])
    surface.evaluate("GodotApp.run('fail', null)")
    await frames(4)
  verify(node("ty-fallback").is_empty() and data().errors.is_empty() and react().mounts == 1 and react().childMounts == 1 and react().count == 1, "ErrorBoundary recupera os quatro negativos sem perder estado nem causar erro do host")
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
      value += ink_at(image, x, y)
  return value

func near_color(pixel: Color, wanted: Color) -> bool:
  return absf(pixel.r - wanted.r) < 0.15 and absf(pixel.g - wanted.g) < 0.15 and absf(pixel.b - wanted.b) < 0.15

# The share of the columns of a decoration segment that hold the wanted color in the pixel rows around the line, moved
# down by shift pixels. Segments are in the paragraph's coordinates, so they follow the control to the screen.
func line_coverage(image: Image, id: String, row: Dictionary, wanted: Color, shift: float) -> float:
  var origin: Vector2 = surface.find_child(id, true, false).get_global_rect().position
  var first := int(floor(origin.x + float(row.x0))) + 1
  var last := int(ceil(origin.x + float(row.x1))) - 1
  var y := int(floor(origin.y + float(row.y) + shift))
  var covered := 0
  for x in range(first, last):
    var found := false
    for dy in range(-1, 2):
      found = found or near_color(image.get_pixel(x, y + dy), wanted)
    covered += int(found)
  return float(covered) / float(last - first) if last > first else 0.0

# How far the ink of the upper half of a paragraph sits to the right of the ink of its lower half, in pixels: the lean.
func slant(image: Image, id: String) -> float:
  var rect := Rect2i((surface.find_child(id, true, false) as Control).get_global_rect())
  var first := rect.end.y
  var last := rect.position.y
  for y in range(rect.position.y, rect.end.y):
    for x in range(rect.position.x, rect.end.x):
      if ink_at(image, x, y) > 0.0:
        first = mini(first, y)
        last = maxi(last, y)
  var middle := (first + last) / 2
  return half_mean(image, rect, first, middle) - half_mean(image, rect, middle + 1, last)

func ink_at(image: Image, x: int, y: int) -> float:
  var c := image.get_pixel(x, y)
  return maxf(0, minf(c.r, minf(c.g, c.b)) - 0.06)

func half_mean(image: Image, rect: Rect2i, first: int, last: int) -> float:
  var total := 0.0
  var weighted := 0.0
  for y in range(first, last + 1):
    for x in range(rect.position.x, rect.end.x):
      var weight := ink_at(image, x, y)
      total += weight
      weighted += weight * x
  return weighted / total if total > 0.0 else 0.0

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
    verify(slant(image, "ty-italic") - slant(image, "ty-upright") > 1.0, "Pixels confirmam que o itálico sintético inclina a tinta para a direita")
    var orange := Color("f97316")
    var colored: Dictionary = node("ty-lines").decorations[2]
    verify(line_coverage(image, "ty-lines", colored, orange, 0.0) > 0.9 and line_coverage(image, "ty-lines", colored, orange, -6.0) == 0.0
      and line_coverage(image, "ty-lines", colored, orange, 6.0) == 0.0,
      "Pixels confirmam a linha de textDecorationColor na altura do sublinhado e em nenhuma outra")
    var rose := Color("fb7185")
    var struck: Dictionary = node("ty-lines").decorations[1]
    verify(line_coverage(image, "ty-lines", struck, rose, 0.0) > 0.9 and line_coverage(image, "ty-lines", struck, rose, -6.0) == 0.0
      and line_coverage(image, "ty-lines", struck, rose, 6.0) == 0.0,
      "Pixels confirmam o tachado no meio da caixa do trecho")
    var sky := Color("38bdf8")
    var before: Dictionary = node("ty-cancel").decorations[0]
    var after: Dictionary = node("ty-cancel").decorations[1]
    var hole := {"x0": float(before.x1) + 2.0, "x1": float(after.x0) - 2.0, "y": before.y}
    verify(line_coverage(image, "ty-cancel", before, sky, 0.0) > 0.9 and line_coverage(image, "ty-cancel", after, sky, 0.0) > 0.9
      and line_coverage(image, "ty-cancel", hole, sky, 0.0) < 0.1,
      "Pixels confirmam o sublinhado do pai e o buraco deixado pelo span que o cancela")
  verify(image.save_png("res://build/typography-" + stage + ".png") == OK, "Captura real salva: " + stage)
