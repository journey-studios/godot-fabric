extends "res://tests/images-network-base.gd"

# RN's own Image over the host's network image pipeline: sources on http and https, loaded from the suite's local server
# (tests/images-network-server.mjs: a child process of the runner whose ports arrive as user arguments), through the loader's own
# HTTP transport, decoded on Godot's worker pool and kept in the decoded and byte caches. This probe reads what JS observed, what
# the native views and the loader report, and, through its own HTTPClient, what the server recorded. Every wait is for a state
# (a log complete, a request held at the server, a connection closed, the loader idle), never for a number of frames or seconds;
# the limit that bounds each wait is only there to turn a hang into a failure. Time is moved through the validation clock offset,
# which both the idle timeout and the freshness of cached responses run on: nothing sleeps.
#
# A normative check needs the native network images: the preceding host fails every http(s) source, so it must fail exactly those
# checks, and every other check holds on both.

# ---- helpers of the stages ----

func quote(text: String) -> String:
  return JSON.stringify(text)

# $http/... to the server's address, as the fixture's fill() does.
func fill(text: String) -> String:
  return text.replace("$https", String(inputs.https)).replace("$http", String(inputs.http)).replace("$other", String(inputs.other)).replace("$refused", String(inputs.refused))

# The path and query of a URL on one of the suite's origins, as the server records it.
func target_of(url: String) -> String:
  var scheme_end := url.find("://")
  return url.substr(url.find("/", scheme_end + 3)) if scheme_end >= 0 else url

func mount_image(id: String, spec: Dictionary) -> void:
  run_js("mount(" + quote(id) + ", " + JSON.stringify(spec) + ")")

func unmount_image(id: String) -> void:
  run_js("unmount(" + quote(id) + ")")

func square(target: String, size: int = 24, extra: Dictionary = {}) -> Dictionary:
  var source := {"uri": target}
  source.merge(extra, true)
  return {"source": source, "style": {"width": size, "height": size}}

# loadStart, progress (once or more), then load and loadEnd: what a download that succeeds tells JS.
func ordered(id: String) -> bool:
  var types := types_of(id)
  if types.size() < 4 or types[0] != "loadStart" or types[types.size() - 2] != "load" or types[types.size() - 1] != "loadEnd":
    return false
  return types.slice(1, types.size() - 2).all(func(type: String) -> bool: return type == "progress")

func loaded_as(id: String, format: String, width: int, height: int) -> bool:
  var made := picture(id)
  return (String(view(id).get("status", "")) == "loaded" and String(made.get("format", "")) == format and int(made.get("width", 0)) == width
    and int(made.get("height", 0)) == height)

# The progress events of a download: cumulative bytes that only grow, over the same total, which are the bytes of the whole when the
# last one comes; the fraction is loaded over total (negative while the total is unknown, as iOS reports it).
func progress_follows(id: String, total: int, whole: int) -> bool:
  var events := events_of(id, "progress")
  if events.is_empty():
    return false
  var previous := 0
  for event: Dictionary in events:
    var loaded := int(event.loaded)
    if loaded <= previous or int(event.total) != total or not is_equal_approx(float(event.progress), float(loaded) / float(total)):
      return false
    previous = loaded
  return previous == whole

func error_of(id: String) -> Dictionary:
  return event_of(id, "error")

func header_of(event: Dictionary, name: String) -> String:
  for key: String in event.get("httpResponseHeaders", {}):
    if key.to_lower() == name:
      return String(event.httpResponseHeaders[key])
  return ""

func raw_header(row: Dictionary, name: String) -> String:
  var raw: Array = row.get("rawHeaders", [])
  for index in range(0, raw.size() - 1, 2):
    if String(raw[index]).to_lower() == name:
      return String(raw[index + 1])
  return ABSENT

func body_text(row: Dictionary) -> String:
  return Marshalls.base64_to_raw(String(row.get("bodyBase64", ""))).get_string_from_utf8()

func settled_loader(expected_requests: int = 0) -> bool:
  return await wait_until(func() -> bool: return idle(expected_requests))

# ---- stages ----

func mount_stage() -> void:
  var value := react()
  var nodes: Array = native(surface).get("nodes", []).filter(func(row: Dictionary) -> bool: return row.kind == "image")
  check(nodes.size() == declared.size() and not value.is_empty(), "mount/Every declared Image mounts one native GodotImage")
  check(errors().is_empty(), "mount/The application reports no host or runtime error")
  check(int(counters().get("requested", 0)) == declared.size(), "mount/Every Image asked the loader for exactly one request")
  check(value.get("boundaries", {"missing": true}).is_empty(), "mount/No Image fails to render: the wrapper takes the request keys of a source, and crossOrigin and referrerPolicy")
  stages.mount = {"react": value, "nodes": nodes.size(), "surface": native(surface), "loader": loader(), "declared": declared}

func loads_stage() -> void:
  var png_cases := ["ok", "ok-https", "ok-chunked", "ok-redirect", "ok-redirect-cross", "req-post", "req-get-body", "req-props"]
  var sized := png_cases.all(func(id: String) -> bool: return loaded_as(id, "png", 24, 24))
  check(sized and loaded_as("ok-jpg", "jpeg", 24, 24) and loaded_as("ok-wide", "png", 40, 20) and loaded_as("ok-svg", "svg", 48, 48),
    "loads/Pictures served over http and https load, with redirects and chunked bodies: PNG, JPEG, SVG and a wide PNG at the sizes of their headers", true)
  var exact := fingerprint("formats/format.png")
  check(exact != "?" and ["ok", "ok-https", "ok-chunked", "ok-redirect", "req-post"].all(func(id: String) -> bool: return String(picture(id).get("fingerprint", "")) == exact),
    "loads/The decoded pixels of a PNG downloaded over http, https, chunked or after a redirect are those of the file", true)
  var in_order := png_cases.all(func(id: String) -> bool: return ordered(id)) and ordered("ok-jpg") and ordered("ok-wide") and ordered("ok-svg")
  check(in_order, "loads/A download reports loadStart, then its progress, then load and loadEnd", true)
  var whole := int(manifest.files["formats/format.png"].bytes)
  check(progress_follows("ok", whole, whole) and progress_follows("ok-https", whole, whole) and progress_follows("ok-redirect", whole, whole),
    "progress/Progress is cumulative: the bytes so far over the Content-Length, ending at the whole", true)
  check(progress_follows("ok-chunked", -1, whole), "progress/A chunked body has no total: -1, and a fraction that is negative, loaded over -1", true)
  var wide := picture("ok-wide")
  var wide_view := view("ok-wide")
  check(int(wide.get("sourceWidth", 0)) == 40 and rect(wide_view.get("drawn", {}).get("dst", null)) == [0.0, 0.0, 60.0, 60.0]
    and rect(wide_view.get("drawn", {}).get("src", null)) == [5.0, 0.0, 10.0, 10.0],
    "loads/A downloaded picture is drawn like any other: a 40x20 pixel picture is 20x10 points at scale 2, and cover crops it to the 60x60 frame", true)
  var redirect_load := event_of("ok-redirect", "load")
  check(String(redirect_load.get("uri", "")) == inputs.http + "/redirect/302?to=/pic/plain/quad24.png" and int(redirect_load.get("width", 0)) == 24,
    "redirects/onLoad reports the uri the source asked for after the redirect was followed", true)
  var hops: Array = await requests_for("/redirect/302?to=/pic/plain/quad24.png")
  var landed: Array = await requests_for("/pic/plain/quad24.png")
  check(hops.size() == 1 and landed.size() >= 1, "redirects/The server saw the redirect and the picture it led to", true)
  var cross: Array = (await server_log()).get("records", []).filter(func(row: Dictionary) -> bool: return String(row.listener) == "other" and String(row.url) == "/pic/plain/quad24.png")
  var first_hop: Array = await requests_for("/redirect/307?to=" + inputs.other + "/pic/plain/quad24.png")
  check(cross.size() == 1 and raw_header(cross[0], "x-keep") == ABSENT and raw_header(cross[0], "authorization") == ABSENT
    and first_hop.size() == 1 and raw_header(first_hop[0], "authorization") == "secret" and raw_header(first_hop[0], "x-keep") == "kept"
    and raw_header(hops[0], "x-keep") == "kept" and landed.all(func(row: Dictionary) -> bool: return raw_header(row, "x-keep") == ABSENT),
    "redirects/A redirect drops the source's headers, as RCTHTTPRequestHandler's redirect delegate does: the request it leads to reaches the server without them, to another origin or not", true)
  stages.loads = {"exact": exact}

func requests_stage() -> void:
  var posted: Array = await requests_for("/pic/plain/quad24.png?post")
  var got: Array = await requests_for("/pic/plain/quad24.png?get-body")
  var props: Array = await requests_for("/pic/plain/quad24.png?props")
  check(posted.size() == 1 and String(posted[0].method) == "POST" and raw_header(posted[0], "x-probe") == "one" and raw_header(posted[0], "accept") == "image/png"
    and body_text(posted[0]) == "hello body", "request/The method (upper-cased), headers and body of a source reach the server as declared", true)
  check(got.size() == 1 and String(got[0].method) == "GET" and body_text(got[0]) == "a body on a GET", "request/A body goes with any method, a GET included", true)
  check(props.size() == 1 and raw_header(props[0], "access-control-allow-credentials") == "true" and raw_header(props[0], "referrer-policy") == "origin",
    "request/crossOrigin and referrerPolicy become the headers RN's Image gives them", true)
  var plain: Array = await requests_for("/pic/plain/quad24.png")
  check(plain.size() >= 1 and plain.all(func(row: Dictionary) -> bool: return String(row.method) == "GET" and raw_header(row, "cookie") == ABSENT and raw_header(row, "accept-encoding") == ABSENT),
    "request/A plain source is a GET with no cookies and no compression offered", true)
  stages.requests = {"posted": posted, "got": got, "props": props}

func failures_stage() -> void:
  var not_found := error_of("err-404")
  var final_404: String = String(inputs.http) + "/status/404"
  check(String(not_found.get("error", "")) == "Failed to load " + final_404 and int(not_found.get("responseCode", 0)) == 404 and header_of(not_found, "x-reason") == "no luck"
    and header_of(not_found, "set-cookie") == "a=1, b=2", "failures/A status other than 200 fails with Failed to load <URL>, its code and the response headers, repeats joined", true)
  var redirected := error_of("err-redirect-404")
  check(String(redirected.get("error", "")) == "Failed to load " + final_404 and int(redirected.get("responseCode", 0)) == 404,
    "failures/After a redirect the failure names the final URL", true)
  var no_data := error_of("err-503-empty")
  var empty := error_of("err-empty200")
  check(String(no_data.get("error", "")) == "Unknown image download error" and int(no_data.get("responseCode", 0)) == 503 and header_of(no_data, "x-reason") == "no luck"
    and String(empty.get("error", "")) == "Unknown image download error" and int(empty.get("responseCode", 0)) == 200 and header_of(empty, "x-reason") == "empty",
    "failures/An empty body fails with Unknown image download error, with the code and headers of its response, whatever the status", true)
  var undecodable := ["err-html", "err-corrupt", "err-oversize"]
  var bare := undecodable.all(func(id: String) -> bool:
    var event := error_of(id)
    return String(event.get("error", "")).begins_with("Error decoding image data <") and not event.has("responseCode") and not event.has("httpResponseHeaders"))
  check(bare and String(error_of("err-html").error).contains("not an image format") and String(error_of("err-oversize").error).contains("over the host limit"),
    "failures/A 200 whose body is not a picture fails with the decode error alone: no code and no headers", true)
  var refused := error_of("err-refused")
  var reset := error_of("err-reset")
  check(String(refused.get("error", "")) == "Failed to connect to 127.0.0.1:" + str(int(ports.refused)) and not refused.has("responseCode") and not refused.has("httpResponseHeaders")
    and String(reset.get("error", "")).contains("before a response arrived") and not reset.has("responseCode"),
    "failures/A connection refused or lost before the response fails with the transport's message and no code", true)
  var cut := error_of("err-truncated")
  var cut_progress := events_of("err-truncated", "progress")
  var cut_error := String(cut.get("error", ""))
  check((cut_error.contains("unexpected end of stream") or cut_error.contains("was lost while receiving the response")) and int(cut.get("responseCode", 0)) == 200 and header_of(cut, "x-reason") == "cut"
    and cut_progress.all(func(event: Dictionary) -> bool: return int(event.loaded) < int(event.total)),
    "failures/A connection lost in the body fails with the transport's message, the 200 and the headers that came, and whatever progress it had reported falls short of the total", true)
  var badly := String(error_of("err-header-name").get("error", ""))
  var unsupported := String(error_of("err-method").get("error", ""))
  var unsent: Array = (await requests_for("/pic/plain/quad24.png?bad-header")) + (await requests_for("/pic/plain/quad24.png?brew"))
  check(badly == "The image source has an invalid header name: \"Bad Name\"" and unsupported == "Unsupported HTTP method: BREW" and unsent.is_empty(),
    "failures/A header the wire cannot carry and a method the transport cannot send fail through onError, and nothing reaches the server", true)
  var uncached := String(error_of("err-only-if-cached").get("error", ""))
  var asked: Array = await requests_for("/pic/plain/quad24.png?never-cached")
  check(uncached.contains("only-if-cached") and asked.is_empty(), "failures/only-if-cached with nothing cached fails naming the policy, without a request", true)
  var ids := ["err-404", "err-503-empty", "err-empty200", "err-html", "err-corrupt", "err-oversize", "err-reset", "err-truncated", "err-refused", "err-redirect-404", "err-header-name", "err-method", "err-only-if-cached"]
  var textureless := ids.all(func(id: String) -> bool:
    var types := types_of(id)
    return (types.size() >= 3 and types[0] == "loadStart" and types[types.size() - 2] == "error" and types[types.size() - 1] == "loadEnd" and view(id).get("image", null) == null
      and String(view(id).get("status", "")) == "failed" and view(id).get("drawn", null) == null))
  check(textureless, "failures/A failed Image ends with error and loadEnd, leaves no texture and draws nothing")
  stages.failures = {"ids": ids}

func threads_stage() -> void:
  var state := loader()
  var host := String(state.hostThread)
  var decoded: Array = jobs_since(0).filter(func(job: Dictionary) -> bool: return String(job.source) == "network" and String(job.format) != "" and String(job.outcome) != "cancelled")
  var on_workers := decoded.all(func(job: Dictionary) -> bool: return bool(job.thread.worker) and String(job.thread.id) != host)
  check(not decoded.is_empty() and on_workers, "threads/The bytes of every downloaded picture were sniffed, measured and decoded on a worker thread: the recorded identity of each job differs from the main thread's", true)
  var done: Dictionary = state.counters
  check(int(done.tasksStarted) == int(done.tasksAwaited) and int(state.inFlight) == 0, "threads/Every task the pool handed out was awaited")
  stages.threads = {"host": host, "decoded": decoded.size()}

func concurrency_stage() -> void:
  collect_jobs()
  var abandoned_before := number(network(), "abandoned")
  for index in range(1, 7):
    mount_image("h" + str(index), square("$http/hang-body/h" + str(index)))
  # Six downloads are asked for and the server holds every one it receives: four run, in the order asked, and two wait.
  var held := true
  for index in range(1, 5):
    held = held and await wait_for_hold("h" + str(index), "waiting")
  var four := await wait_until(func() -> bool: return number(network(), "active") == 4 and number(network(), "queued") == 2)
  var first_four: Dictionary = section(await server_log(), "holds")
  var at_peak := network()
  check(held and four and first_four.keys() == ["h1", "h2", "h3", "h4"] and number(at_peak, "peakActive") == 4,
    "concurrency/At most four downloads run at once: the server holds the first four asked for and the loader queues the other two", true)
  mount_image("h7", square("$http/hang-body/h7"))
  var queued_three := await wait_until(func() -> bool: return number(network(), "queued") == 3)
  unmount_image("h7")
  await release("h1")
  var fifth := await wait_for_hold("h5", "waiting")
  var sixth_early := await hold_state("h6")
  check(queued_three and fifth and sixth_early == "none" and number(network(), "active") == 4,
    "concurrency/A download that ends makes room for the next in line, and for no other: h5 starts while h6 still waits", true)
  await release("h2")
  var sixth := await wait_for_hold("h6", "waiting")
  for index in range(3, 7):
    await release("h" + str(index))
  var finished := await wait_until(func() -> bool: return ["h1", "h2", "h3", "h4", "h5", "h6"].all(func(id: String) -> bool: return ended(id)))
  await settled_loader()
  var unseen: Array = await requests_for("/hang-body/h7")
  var after := network()
  check(sixth and finished and ["h1", "h2", "h3", "h4", "h5", "h6"].all(func(id: String) -> bool: return ordered(id)) and number(after, "peakActive") == 4,
    "concurrency/All six pictures load once released, and never more than four were active", true)
  check(unseen.is_empty() and types_of("h7") == ["loadStart"] and number(after, "abandoned") == abandoned_before + 1,
    "concurrency/A download unmounted while it waited for a slot never starts: the server never sees it and the loader counts it abandoned", true)
  stages.concurrency = {"holds": first_four, "atPeak": at_peak, "after": after, "sixthEarly": sixth_early}

func partial_stage() -> void:
  mount_image("partial", square("$http/hang-body/partial"))
  var held := await wait_for_hold("partial", "waiting")
  var seen := await wait_until(func() -> bool: return not events_of("partial", "progress").is_empty())
  var midway := events_of("partial", "progress")
  var midway_types := types_of("partial")
  var total := int(manifest.files["formats/format.png"].bytes)
  check(held and seen and midway.all(func(event: Dictionary) -> bool:
    return (int(event.loaded) > 0 and int(event.loaded) < total and int(event.total) == total and is_equal_approx(float(event.progress), float(event.loaded) / float(total))))
    and not midway_types.has("load") and not midway_types.has("error"),
    "progress/While only part of the body has arrived the Image reports the bytes so far over the whole, and has not loaded", true)
  await release("partial")
  await wait_until(func() -> bool: return ended("partial"))
  check(ordered("partial") and progress_follows("partial", total, total), "progress/The last progress event is the whole body, and the load follows it", true)
  stages.partial = {"midway": midway, "log": log_of("partial")}

func cancel_stage() -> void:
  collect_jobs()
  var before := network()
  var before_jobs := last_job
  mount_image("cancel-body", square("$http/hang-body/cancel-body"))
  mount_image("cancel-head", square("$http/hang-head/cancel-head"))
  var held := await wait_for_hold("cancel-body", "waiting") and await wait_for_hold("cancel-head", "waiting")
  await wait_until(func() -> bool: return not events_of("cancel-body", "progress").is_empty())
  var body_before := types_of("cancel-body")
  var uploads := number(counters(), "uploads")
  unmount_image("cancel-body")
  unmount_image("cancel-head")
  var left := await wait_for_hold("cancel-body", "closed-by-client") and await wait_for_hold("cancel-head", "closed-by-client")
  await settled_loader()
  await frames(10)
  var after := network()
  var cancelled_jobs: Array = jobs_since(before_jobs).filter(func(job: Dictionary) -> bool: return String(job.uri).contains("/hang-") and String(job.outcome) == "cancelled")
  check(held and left and number(after, "abandoned") == number(before, "abandoned") + 2 and number(section(after, "transport"), "cancelled") == number(section(before, "transport"), "cancelled") + 2
    and number(section(after, "transport"), "active") == 0, "cancel/Unmounting an Image mid-download, before or after the head, closes its request: the server sees the client leave and the transport counts the cancellation", true)
  check(types_of("cancel-body") == body_before and types_of("cancel-head") == ["loadStart"] and cancelled_jobs.size() == 2 and number(counters(), "uploads") == uploads,
    "cancel/A cancelled download delivers nothing to JS and creates no texture", true)
  await release("cancel-body")
  await release("cancel-head")
  # A source that changes while it downloads replaces its request: the old one is closed and only the new one reports.
  mount_image("swap", square("$http/hang-body/swap-a"))
  var swap_held := await wait_for_hold("swap-a", "waiting")
  await wait_until(func() -> bool: return not events_of("swap", "progress").is_empty())
  run_js("update(" + quote("swap") + ", " + JSON.stringify({"source": {"uri": "$http/pic/plain/quad24.png?swap-b"}}) + ")")
  var swap_left := await wait_for_hold("swap-a", "closed-by-client")
  await wait_until(func() -> bool: return ended("swap"))
  var swap_types := types_of("swap")
  check(swap_held and swap_left and swap_types.count("loadStart") == 2 and swap_types.count("load") == 1 and swap_types.count("error") == 0 and swap_types[swap_types.size() - 1] == "loadEnd"
    and String(event_of("swap", "load").get("uri", "")).ends_with("quad24.png?swap-b"), "cancel/Swapping the source mid-download closes the old request and only the new one loads", true)
  await release("swap-a")
  stages.cancel = {"before": before, "after": after, "bodyBefore": body_before, "swap": log_of("swap")}

func limits_stage() -> void:
  run_js("responseLimit(4096)")
  var aborted := number(network(), "abortedBySize")
  var ids := ["cap-announced", "cap-chunked", "cap-exact"]
  mount_image("cap-announced", square("$http/big/8000"))
  mount_image("cap-chunked", square("$http/big-chunked/8000"))
  mount_image("cap-exact", square("$http/big/4096"))
  await wait_until(func() -> bool: return ids.all(func(id: String) -> bool: return ended(id)))
  run_js("responseLimit(0)")
  mount_image("cap-restored", square("$http/big/8000"))
  await wait_until(func() -> bool: return ended("cap-restored"))
  await settled_loader()
  var announced := error_of("cap-announced")
  var chunked := error_of("cap-chunked")
  check(String(announced.get("error", "")) == "The image is 8000 bytes, over the host limit of 4096" and int(announced.get("responseCode", 0)) == 200
    and header_of(announced, "content-length") == "8000" and String(chunked.get("error", "")) == "The image download passed the host limit of 4096 bytes"
    and int(chunked.get("responseCode", 0)) == 200 and number(network(), "abortedBySize") == aborted + 2,
    "limits/A response over the size limit is refused, announced by its Content-Length or found out as it arrives, with the response that came", true)
  var exact := error_of("cap-exact")
  var restored := error_of("cap-restored")
  check(String(exact.get("error", "")).begins_with("Error decoding image data <4096 bytes>") and not exact.has("responseCode")
    and String(restored.get("error", "")).begins_with("Error decoding image data <8000 bytes>"),
    "limits/A response of exactly the limit is accepted (it fails later, as the bytes are not a picture), and restoring the default limit accepts the larger one", true)
  stages.limits = {"announced": announced, "chunked": chunked, "exact": exact, "restored": restored}

func idle_stage() -> void:
  mount_image("idle-body", square("$http/hang-body/idle-body"))
  mount_image("idle-head", square("$http/hang-head/idle-head"))
  var held := await wait_for_hold("idle-body", "waiting") and await wait_for_hold("idle-head", "waiting")
  await wait_until(func() -> bool: return not events_of("idle-body", "progress").is_empty())
  var waiting := {"body": types_of("idle-body"), "head": types_of("idle-head")}
  var aborted := number(network(), "abortedByIdle")
  # Neither download has heard from the server for a minute, as far as the clock the application runs on can tell.
  advance(90000.0)
  await wait_until(func() -> bool: return ended("idle-body") and ended("idle-head"))
  var body := error_of("idle-body")
  var head := error_of("idle-head")
  check(held and waiting.body.has("progress") and not waiting.body.has("error") and waiting.head == ["loadStart"] and String(body.get("error", "")) == "The request timed out."
    and int(body.get("responseCode", 0)) == 200 and header_of(body, "content-length") != "" and String(head.get("error", "")) == "The request timed out."
    and not head.has("responseCode") and number(network(), "abortedByIdle") == aborted + 2,
    "limits/A download that receives nothing for the idle timeout fails with the timeout message, with the response if the head had come", true)
  var left := await wait_for_hold("idle-body", "closed-by-client") and await wait_for_hold("idle-head", "closed-by-client")
  check(left, "limits/The requests that timed out are closed: the server sees the client leave", true)
  await release("idle-body")
  await release("idle-head")
  stages.idle = {"waiting": waiting, "body": body, "head": head, "offsetMs": offset_ms}

# ---- the operations the caches are certified over ----
# Each operation is done alone and ends before the next begins, and is recorded with the clock it ran at: the oracle replays the list
# against its own model of the two caches and the server's answers, and the two must agree on where every picture came from.

func job_since(before: int, uri: String, kinds: Array) -> Dictionary:
  for job: Dictionary in jobs_since(before):
    if String(job.uri) == uri and kinds.has(String(job.kind)):
      return job
  return {}

func now_ms() -> float:
  return Time.get_unix_time_from_system() * 1000.0

func view_op(label: String, target: String, size: int = 24, policy: String = "default", extra: Dictionary = {}, headers: Dictionary = {}) -> Dictionary:
  collect_jobs()
  var before := last_job
  var filled := fill(target)
  var spec := square(target, size)
  if policy != "default":
    spec.source["cache"] = policy
  if not headers.is_empty():
    spec.source["headers"] = headers
  spec.merge(extra, true)
  var unix := now_ms()
  mount_image(label, spec)
  await wait_until(func() -> bool: return ended(label))
  var job := job_since(before, filled, ["network"])
  var made := picture(label)
  var op := {"label": label, "kind": "view", "uri": filled, "width": size, "height": size, "scale": SCALE, "policy": policy, "headers": headers, "offset": offset_ms, "unix": unix,
    "served": job.get("served", ""), "outcome": job.get("outcome", ""), "error": job.get("error", ""), "jobId": job.get("id", -1), "events": types_of(label),
    "format": made.get("format", ""), "pictureWidth": made.get("width", 0), "pictureHeight": made.get("height", 0), "fingerprint": made.get("fingerprint", "")}
  ops.append(op)
  return op

# What an Image static settled with, in one shape: whether it resolved, its value (null when it did not), and its message ("" when it did).
func answer_of(label: String) -> Dictionary:
  var raw: Variant = react().get("results", {}).get(label, null)
  if not raw is Dictionary:
    return {"ok": false, "value": null, "message": "no answer", "code": null}
  return {"ok": bool(raw.get("ok", false)), "value": raw.get("value", null), "message": String(raw.get("message", "")), "code": raw.get("code", null)}

# Equal in type and in value: GDScript refuses to compare a Dictionary with an Array.
func equal(a: Variant, b: Variant) -> bool:
  return typeof(a) == typeof(b) and a == b

# `headers_js` is the JavaScript text of the headers object when its values are not all strings (a number or a boolean): GDScript's JSON would
# decide how a float is written, and the point of such a call is what the host writes for the value.
func static_op(label: String, kind: String, target: String, headers: Dictionary = {}, headers_js: String = "") -> Dictionary:
  collect_jobs()
  var before := last_job
  var filled := fill(target)
  var unix := now_ms()
  match kind:
    "getSize": run_js("getSize(" + quote(label) + ", " + quote(target) + ")")
    "getSizeWithHeaders": run_js("getSizeWithHeaders(" + quote(label) + ", " + quote(target) + ", " + (JSON.stringify(headers) if headers_js.is_empty() else headers_js) + ")")
    "prefetch": run_js("prefetch(" + quote(label) + ", " + quote(target) + ")")
    "prefetchWithMetadata": run_js("prefetchWithMetadata(" + quote(label) + ", " + quote(target) + ")")
  await wait_until(func() -> bool: return react().get("results", {}).has(label))
  var result := answer_of(label)
  var job := job_since(before, filled, ["measure", "prefetch"])
  var op := {"label": label, "kind": kind, "uri": filled, "headers": headers, "offset": offset_ms, "unix": unix, "result": result, "served": job.get("served", ""),
    "outcome": job.get("outcome", ""), "jobId": job.get("id", -1)}
  ops.append(op)
  return op

func query_op(label: String, targets: Array) -> Dictionary:
  var filled: Array = targets.map(func(target: String) -> String: return fill(target))
  run_js("queryCache(" + quote(label) + ", " + JSON.stringify(targets) + ")")
  await wait_until(func() -> bool: return react().get("results", {}).has(label))
  var op := {"label": label, "kind": "queryCache", "uris": filled, "offset": offset_ms, "unix": now_ms(), "result": answer_of(label)}
  ops.append(op)
  return op

func memory_op(label: String) -> Dictionary:
  var before := caches()
  var cleared := number(counters(), "cacheClears")
  # The exact call the platform layers make when the OS warns of low memory.
  Engine.get_main_loop().notification(MEMORY)
  var after := caches()
  var op := {"label": label, "kind": "memory", "offset": offset_ms, "unix": now_ms(), "before": {"decoded": number(section(before, "decoded"), "entries"), "bytes": number(section(before, "bytes"), "entries")},
    "after": {"decoded": number(section(after, "decoded"), "entries"), "bytes": number(section(after, "bytes"), "entries")}, "clears": number(counters(), "cacheClears") - cleared}
  ops.append(op)
  return op

# The keys both caches hold, most recently used first, at a point the oracle's model of them must reach too.
func checkpoint(label: String) -> void:
  ops.append({"kind": "checkpoint", "label": label, "decoded": cache_keys("decoded"), "bytes": cache_keys("bytes")})

func served(op: Dictionary) -> String:
  return String(op.get("served", ""))

func requests_count(target: String) -> int:
  return (await requests_for(target_of(fill(target)))).size()

func live_textures() -> int:
  return number(loader(), "liveTextures")

func cache_keys(which: String) -> Array:
  return section(caches(), which).get("keys", [])

func loaded_op(op: Dictionary) -> bool:
  return String(op.outcome) == "loaded"

func memory_stage() -> void:
  # The first operation clears both caches, whatever the pictures of the stages before left in them: the operations that follow start from nothing.
  var before := caches()
  var warned := memory_op("memory-1")
  check(int(warned.before.decoded) > 0 and int(warned.before.bytes) > 0 and int(warned.after.decoded) == 0 and int(warned.after.bytes) == 0 and int(warned.clears) == 1,
    "memory/The OS memory warning empties both caches, the decoded pictures and the downloaded responses", true)
  stages.memory = {"before": before, "after": caches()}

func decoded_stage() -> void:
  var c1 := "$http/pic/max-age/quad24.png?c1"
  var textures := live_textures()
  var first := await view_op("c1-first", c1)
  var same := await view_op("c1-same", c1)
  var requests_after_same := await requests_count(c1)
  var shared := live_textures() - textures
  check(first.served == "network" and same.served == "decoded" and requests_after_same == 1 and types_of("c1-same") == ["loadStart", "load", "loadEnd"] and shared == 1
    and String(same.fingerprint) == String(first.fingerprint),
    "cache/A second Image of the same URL, size and scale is answered by the decoded cache: no request, no download progress, one picture for both", true)
  var resized := await view_op("c1-size", c1, 30)
  var requests_after_size := await requests_count(c1)
  check(resized.served == "bytes" and requests_after_size == 1 and types_of("c1-size") == ["loadStart", "load", "loadEnd"] and int(resized.pictureWidth) == 24,
    "cache/Another size is another picture: the decoded cache misses and the byte cache answers, with no request", true)
  var reloaded := await view_op("c1-reload", c1, 24, "reload")
  var requests_after_reload := await requests_count(c1)
  var after_reload := await view_op("c1-after-reload", c1)
  check(reloaded.served == "network" and requests_after_reload == 2 and after_reload.served == "decoded" and await requests_count(c1) == 2,
    "cache/reload ignores both caches and asks the server again, and leaves the decoded picture where it was", true)
  var c3 := "$http/pic/max-age/quad24.png?c3"
  var reload_first := await view_op("c3-reload", c3, 24, "reload")
  var after_reload_default := await view_op("c3-default", c3)
  var then_decoded := await view_op("c3-default-2", c3)
  check(reload_first.served == "network" and after_reload_default.served == "bytes" and then_decoded.served == "decoded" and await requests_count(c3) == 1,
    "cache/A reload does not store the decoded picture (the next request decodes the bytes again) but the response is kept (no request)", true)
  checkpoint("after-decoded")
  stages.decoded = {"shared": shared, "keys": cache_keys("decoded")}

func shared_stage() -> void:
  var target := "$http/pic/plain/wide.png?share"
  var textures := live_textures()
  var a := await view_op("share-a", target, 60, "default", {"resizeMode": "cover"})
  var b := await view_op("share-b", target, 60, "default", {"resizeMode": "repeat"})
  var pair := live_textures() - textures
  var picture_a := picture("share-a")
  var picture_b := picture("share-b")
  var drawn_a: Dictionary = view("share-a").get("drawn", {})
  var drawn_b: Dictionary = view("share-b").get("drawn", {})
  check(b.served == "decoded" and pair == 1 and String(picture_a.get("fingerprint", "a")) == String(picture_b.get("fingerprint", "b")), "shared/Two Images of one cached picture share a single texture", true)
  check(int(picture_a.get("textureWidth", 0)) == 40 and int(picture_a.get("textureHeight", 0)) == 20 and int(picture_b.get("textureWidth", 0)) == 40 and int(picture_b.get("textureHeight", 0)) == 20,
    "shared/Neither Image changes the texture they share: both read the 40x20 pixels of the picture, although one repeats it", true)
  check(rect(drawn_a.get("dst", null)) == [0.0, 0.0, 60.0, 60.0] and rect(drawn_a.get("src", null)) == [5.0, 0.0, 10.0, 10.0] and not bool(drawn_a.get("tiled", true))
    and bool(drawn_b.get("tiled", false)) and float(drawn_b.get("tileWidth", 0)) == 20.0 and float(drawn_b.get("tileHeight", 0)) == 10.0 and rect(drawn_b.get("dst", null)) == [0.0, 0.0, 60.0, 60.0],
    "shared/Each draws its own size: one crops the picture to cover its frame, the other tiles it at its 20x10 points", true)
  # And the other way round, so that neither mode is the one that happened to come first.
  run_js("update(" + quote("share-a") + ", " + JSON.stringify({"resizeMode": "repeat"}) + ")")
  run_js("update(" + quote("share-b") + ", " + JSON.stringify({"resizeMode": "contain"}) + ")")
  await wait_until(func() -> bool: return String(view("share-a").get("mode", "")) == "repeat" and String(view("share-b").get("mode", "")) == "contain")
  await frames(4)
  var swapped_a: Dictionary = view("share-a")
  var swapped_b: Dictionary = view("share-b")
  var swapped_a_drawn: Dictionary = swapped_a.get("drawn", {}) if swapped_a.get("drawn", null) is Dictionary else {}
  var swapped_b_drawn: Dictionary = swapped_b.get("drawn", {}) if swapped_b.get("drawn", null) is Dictionary else {}
  check(int(picture("share-a").get("textureWidth", 0)) == 40 and int(picture("share-b").get("textureWidth", 0)) == 40 and bool(swapped_a_drawn.get("tiled", false))
    and float(swapped_a_drawn.get("tileWidth", 0)) == 20.0 and rect(swapped_b_drawn.get("dst", null)) == [0.0, 15.0, 60.0, 30.0] and a.served == "network",
    "shared/Changing the modes of the two Images changes what each draws and still not the texture", true)
  stages.shared = {"a": view("share-a"), "b": view("share-b"), "live": pair, "first": a.served}

func api_stage() -> void:
  var prefetched := "$http/pic/max-age/quad24.png?c9"
  var first := await static_op("pf-1", "prefetch", prefetched)
  var listed := await query_op("q-1", [prefetched, "$http/pic/max-age/quad24.png?c9-absent"])
  var only := await view_op("pf-only", prefetched, 24, "only-if-cached")
  var forced := await view_op("pf-force", prefetched, 24, "force-cache")
  check(first.result.ok and equal(first.result.value, true) and listed.result.ok and equal(listed.result.value, {fill(prefetched): "memory"}),
    "api/Image.prefetch downloads into the byte cache and resolves true, and Image.queryCache reports exactly the URL it holds, as memory", true)
  check(only.served == "bytes" and loaded_op(only) and forced.served == "decoded" and await requests_count(prefetched) == 1,
    "api/After a prefetch an only-if-cached Image loads with no request, and a force-cache one after it is answered by the decoded picture", true)
  var missing := await view_op("oic-miss", "$http/pic/plain/quad24.png?c9-miss", 24, "only-if-cached")
  check(String(missing.outcome) == "failed" and String(missing.error).contains("only-if-cached") and await requests_count("$http/pic/plain/quad24.png?c9-miss") == 0,
    "api/only-if-cached with nothing in the cache fails naming the policy and asks the server nothing", true)
  var meta := await static_op("pf-meta", "prefetchWithMetadata", "$http/pic/plain/quad24.png?c9-meta")
  var not_found := await static_op("pf-404", "prefetch", "$http/status/404?c9")
  var corrupt := await static_op("pf-corrupt", "prefetch", "$http/pic/plain/corrupt.png?c9")
  var local := await static_op("pf-local", "prefetch", "res://tests/fixtures/images/formats/format.png")
  check(meta.result.ok and equal(meta.result.value, true) and not not_found.result.ok and String(not_found.result.message) == "E_PREFETCH_FAILURE: Failed to load " + fill("$http/status/404?c9")
    and not corrupt.result.ok and String(corrupt.result.message).begins_with("E_PREFETCH_FAILURE: Error decoding image data <") and local.result.ok and equal(local.result.value, true),
    "api/prefetchWithMetadata resolves true; a prefetch that fails rejects with E_PREFETCH_FAILURE and the failure text (a status, a body that does not decode); a local source resolves", true)
  var sized := await static_op("gs-1", "getSize", "$http/pic/max-age/format.jpg?c10")
  var again := await static_op("gs-2", "getSize", "$http/pic/max-age/format.jpg?c10")
  # A number is written as its shortest text that reads back (RCTConvert NSString of 0.123456789 is "0.123456789"), an integer as its digits and a
  # boolean as 1 or 0.
  var with_headers := await static_op("gs-headers", "getSizeWithHeaders", "$http/pic/plain/wide.png?c10h", {"X-Size": "yes"},
    '{"X-Size": "yes", "X-Ratio": 0.123456789, "X-Count": 7, "X-Flag": true}')
  var header_rows: Array = await requests_for(target_of(fill("$http/pic/plain/wide.png?c10h")))
  var huge := await static_op("gs-oversize", "getSize", "$http/pic/plain/oversize.png?c10")
  var gone := await static_op("gs-404", "getSize", "$http/status/404?c10")
  var gone_headers := await static_op("gs-404-headers", "getSizeWithHeaders", "$http/status/404?c10h", {})
  check(sized.result.ok and equal(sized.result.value, {"width": 24.0, "height": 24.0}) and again.result.ok and again.served == "bytes" and await requests_count("$http/pic/max-age/format.jpg?c10") == 1
    and with_headers.result.ok and equal(with_headers.result.value, {"width": 40.0, "height": 20.0}) and header_rows.size() == 1 and raw_header(header_rows[0], "x-size") == "yes"
    and raw_header(header_rows[0], "x-ratio") == "0.123456789" and raw_header(header_rows[0], "x-count") == "7" and raw_header(header_rows[0], "x-flag") == "1"
    and huge.result.ok and equal(huge.result.value, {"width": 65535.0, "height": 65535.0}),
    "api/Image.getSize and getSizeWithHeaders download (or reuse the byte cache), read the header size off the main thread, send their headers, and decode nothing", true)
  check(not gone.result.ok and String(gone.result.message) == "E_GET_SIZE_FAILURE: Failed to getSize of " + fill("$http/status/404?c10") + ": Failed to load " + fill("$http/status/404?c10")
    and not gone_headers.result.ok and String(gone_headers.result.message) == "E_GET_SIZE_FAILURE: Failed to load " + fill("$http/status/404?c10h"),
    "api/A size that cannot be downloaded rejects with E_GET_SIZE_FAILURE and the failure text, with the iOS message of each of the two methods", true)
  var cached := await query_op("q-2", ["$http/pic/max-age/format.jpg?c10", "$http/pic/plain/oversize.png?c10", "$http/status/404?c10", "res://tests/fixtures/images/formats/format.png"])
  check(equal(cached.result.value, {fill("$http/pic/max-age/format.jpg?c10"): "memory", fill("$http/pic/plain/oversize.png?c10"): "memory"}),
    "api/queryCache reports what the byte cache holds, and nothing for a failed download or a source that is not on the network", true)
  stages.api = {"results": react().get("results", {})}

func uncacheable_stage() -> void:
  var kept := true
  for policy: String in ["no-store", "no-cache", "max-age-0"]:
    var target := "$http/pic/%s/quad24.png?c4" % policy
    var one := await view_op(policy + "-1", target)
    var two := await view_op(policy + "-2", target)
    kept = kept and one.served == "network" and two.served == "network" and await requests_count(target) == 2
    kept = kept and not cache_keys("bytes").has(target_of(fill(target)))
  check(kept, "cache/A response that forbids caching, with no-store, no-cache or max-age=0, is kept by neither cache: the second Image asks the server again", true)
  stages.uncacheable = {"decoded": cache_keys("decoded").size(), "bytes": cache_keys("bytes").size()}

func credentials_stage() -> void:
  # Both caches are keyed by URL, so a response fetched with a credential must not answer a request that carries none, nor the other way round:
  # a request with Authorization, Proxy-Authorization or Cookie neither reads nor writes either cache (stricter than iOS, which keys by URL alone).
  # Such a request is only sent over https (iOS blocks cleartext through ATS), so the cases that reach the server use the https listener.
  var shared := "$https/pic/max-age/quad24.png?c11a"
  var plain_first := await view_op("c11-plain-1", shared)
  var with_auth := await view_op("c11-auth", shared, 24, "default", {}, {"Authorization": "Bearer probe"})
  var plain_again := await view_op("c11-plain-2", shared)
  var shared_rows: Array = await requests_for(target_of(fill(shared)))
  var reads: bool = plain_first.served == "network" and with_auth.served == "network" and plain_again.served == "decoded" and shared_rows.size() == 2
  reads = reads and raw_header(shared_rows[1], "authorization") == "Bearer probe" and raw_header(shared_rows[0], "authorization") == ABSENT
  var kept := "$https/pic/max-age/quad24.png?c11b"
  var with_cookie := await view_op("c11-cookie", kept, 24, "default", {}, {"Cookie": "session=probe"})
  var plain_after := await view_op("c11-plain-3", kept)
  var forced := await view_op("c11-proxy", kept, 24, "force-cache", {}, {"Proxy-Authorization": "Basic probe"})
  var only := await view_op("c11-only-if-cached", kept, 24, "only-if-cached", {}, {"Authorization": "Bearer probe"})
  var kept_rows: Array = await requests_for(target_of(fill(kept)))
  var writes: bool = with_cookie.served == "network" and plain_after.served == "network" and forced.served == "network" and kept_rows.size() == 3
  writes = writes and raw_header(kept_rows[0], "cookie") == "session=probe" and raw_header(kept_rows[1], "cookie") == ABSENT
  writes = writes and raw_header(kept_rows[2], "proxy-authorization") == "Basic probe"
  writes = writes and String(only.outcome) == "failed" and String(only.error).contains("only-if-cached") and String(only.error).contains("credentials")
  var sized := "$https/pic/max-age/wide.png?c11w"
  var size_auth := await static_op("c11-gs-auth", "getSizeWithHeaders", sized, {"Authorization": "Bearer probe"})
  var held_after_auth := await query_op("q-c11-1", [sized])
  var size_plain := await static_op("c11-gs-plain", "getSize", sized)
  var held_after_plain := await query_op("q-c11-2", [sized])
  var size_auth_again := await static_op("c11-gs-auth-2", "getSizeWithHeaders", sized, {"authorization": "Bearer probe"})
  var sized_rows: Array = await requests_for(target_of(fill(sized)))
  var measures: bool = size_auth.served == "network" and equal(held_after_auth.result.value, {}) and size_plain.served == "network"
  measures = measures and equal(held_after_plain.result.value, {fill(sized): "memory"}) and size_auth_again.served == "network" and sized_rows.size() == 3
  measures = measures and equal(size_auth_again.result.value, {"width": 40.0, "height": 20.0}) and raw_header(sized_rows[2], "authorization") == "Bearer probe"
  check(reads and writes and measures,
    "cache/A request that carries Authorization, Proxy-Authorization or Cookie neither reads nor writes either cache: it asks the server wherever a response is cached, and what it fetched answers no later request", true)
  # Over http the same requests are not sent at all.
  var cleartext := "$http/pic/max-age/quad24.png?c11h"
  var http_auth := await view_op("c11-http-auth", cleartext, 24, "default", {}, {"Authorization": "Bearer probe"})
  var http_cookie := await view_op("c11-http-cookie", cleartext, 24, "default", {}, {"Cookie": "session=probe"})
  var http_size := await static_op("c11-gs-http", "getSizeWithHeaders", "$http/pic/max-age/wide.png?c11h", {"Proxy-Authorization": "Basic probe"})
  var refused: bool = true
  for op: Dictionary in [http_auth, http_cookie]:
    refused = refused and String(op.outcome) == "failed" and served(op) == "" and String(op.error).contains("carries credentials") and String(op.error).contains("only sent over https")
  refused = refused and not http_size.result.ok and String(http_size.result.message).begins_with("E_GET_SIZE_FAILURE: ") and String(http_size.result.message).contains("carries credentials")
  refused = refused and await requests_count(cleartext) == 0 and await requests_count("$http/pic/max-age/wide.png?c11h") == 0
  check(refused, "failures/A request that carries Authorization, Proxy-Authorization or Cookie over http fails through onError, or rejects a size, with the host's message, and nothing reaches the server", true)
  for label in ["c11-plain-1", "c11-auth", "c11-plain-2", "c11-cookie", "c11-plain-3", "c11-proxy", "c11-only-if-cached", "c11-http-auth", "c11-http-cookie"]:
    unmount_image(label)
  stages.credentials = {"decoded": cache_keys("decoded").size(), "bytes": cache_keys("bytes").size()}

func expiry_stage() -> void:
  var policies := ["max-age", "expires", "heuristic", "plain"]
  var steps: Array = []
  var served_by_step: Dictionary = {}
  var plan := [{"advance": 0.0, "name": "1"}, {"advance": 300000.0, "name": "2"}, {"advance": 1200000.0, "name": "3"}, {"advance": 200000000.0, "name": "4"}]
  for step: Dictionary in plan:
    advance(float(step.advance))
    var row := {}
    for policy: String in policies:
      var op := await view_op(policy + "-" + String(step.name), "$http/pic/%s/quad24.png?c5" % policy)
      row[policy] = served(op)
    served_by_step[String(step.name)] = row
    steps.append(row)
  check(steps[0] == {"max-age": "network", "expires": "network", "heuristic": "network", "plain": "network"}
    and steps[1] == {"max-age": "decoded", "expires": "decoded", "heuristic": "decoded", "plain": "decoded"}
    and steps[2] == {"max-age": "network", "expires": "network", "heuristic": "decoded", "plain": "decoded"}
    and steps[3] == {"max-age": "network", "expires": "network", "heuristic": "network", "plain": "decoded"},
    "cache/A cached picture is served while it is fresh and loaded again once it is stale, as the clock moves: max-age after its seconds, Expires at its date, a heuristic tenth of the time since Last-Modified, and never without any of them", true)
  # Everything in the byte cache is stale now (the clock is days ahead of the Date the server wrote): force-cache still takes it.
  var forced := await view_op("max-age-force", "$http/pic/max-age/quad24.png?c5", 24, "force-cache")
  var only := await view_op("max-age-only", "$http/pic/max-age/quad24.png?c5", 24, "only-if-cached")
  var default := await view_op("max-age-default", "$http/pic/max-age/quad24.png?c5")
  check(forced.served == "bytes" and loaded_op(forced) and only.served == "bytes" and loaded_op(only) and default.served == "network",
    "cache/force-cache and only-if-cached serve a stale response from the byte cache (the picture decoded from it is stale at once and is not kept), and the default policy asks the server again", true)
  stages.expiry = {"steps": steps, "offsetMs": offset_ms}

func limits_of_the_caches_stage() -> void:
  # One picture over the 2 MiB a decoded entry may cost (900x600 pixels at 4 bytes) and one just under it (800x655).
  var over := "$http/pic/plain/big-over.png?c6"
  var fit := "$http/pic/plain/big-fit.png?c6"
  var over_first := await view_op("over-1", over, 450)
  var rejected := number(section(caches(), "decoded"), "rejected")
  var over_second := await view_op("over-2", over, 450)
  var fit_first := await view_op("fit-1", fit, 400)
  var fit_second := await view_op("fit-2", fit, 400)
  check(int(over_first.pictureWidth) == 900 and over_first.served == "network" and over_second.served == "bytes" and await requests_count(over) == 1
    and fit_first.served == "network" and fit_second.served == "decoded" and number(section(caches(), "decoded"), "rejected") >= rejected,
    "cache/The decoded cache keeps no picture over 2 MiB: one of 900x600 pixels is decoded again from the byte cache, one of 800x655 stays", true)
  # The decoded cache holds 20 MiB: of eleven pictures of 2,096,000 bytes the first is the one it gives up.
  for index in range(1, 12):
    await view_op("lru-" + str(index), "$http/pic/plain/big-fit.png?lru=" + str(index), 400)
  var kept: Array = cache_keys("decoded")
  var evicted := number(section(caches(), "decoded"), "evictions")
  var oldest := await view_op("lru-1-again", "$http/pic/plain/big-fit.png?lru=1", 400)
  var newest := await view_op("lru-11-again", "$http/pic/plain/big-fit.png?lru=11", 400)
  var next_oldest := await view_op("lru-2-again", "$http/pic/plain/big-fit.png?lru=2", 400)
  check(evicted >= 1 and not kept.any(func(key: String) -> bool: return key.contains("lru=1|")) and kept.any(func(key: String) -> bool: return key.contains("lru=11|"))
    and oldest.served == "bytes" and newest.served == "decoded" and next_oldest.served == "bytes" and await requests_count("$http/pic/plain/big-fit.png?lru=1") == 1,
    "cache/At its 20 MiB the decoded cache gives up the least recently used picture: the first of eleven is decoded again from bytes, the newest is still there, and asking for the first evicted the next", true)
  for index in range(1, 12):
    unmount_image("lru-" + str(index))
  unmount_image("lru-1-again")
  unmount_image("lru-11-again")
  unmount_image("lru-2-again")
  checkpoint("after-decoded-lru")
  stages.cacheLimits = {"decoded": section(caches(), "decoded"), "kept": kept}

func byte_cache_stage() -> void:
  # The byte cache holds 20 MiB, and no response over a twentieth of that: 21 responses of 1,041,128 bytes, and one of 1,049,311.
  var under := "$http/pic/plain/noise-under.png?n="
  for index in range(1, 22):
    var op := await static_op("noise-" + str(index), "prefetch", under + str(index))
    if index == 1:
      check(op.result.ok and equal(op.result.value, true) and op.served == "network", "bytes/A response of just under 1 MiB is downloaded, decoded to check it is a picture, and kept", true)
  var over := "$http/pic/plain/noise-over.png"
  var over_one := await static_op("noise-over-1", "prefetch", over)
  var over_two := await static_op("noise-over-2", "prefetch", over)
  var urls: Array = []
  for index in range(1, 22):
    urls.append(under + str(index))
  urls.append(over)
  var listed := await query_op("q-noise", urls)
  var held: Dictionary = listed.result.value if listed.result.value is Dictionary else {}
  var expected_held := true
  for index in range(2, 22):
    expected_held = expected_held and held.has(fill(under + str(index)))
  check(expected_held and not held.has(fill(under + "1")) and not held.has(fill(over)) and held.size() == 20,
    "bytes/At its 20 MiB the byte cache gives up the least recently used response, the first of 21, and keeps none over 1 MiB", true)
  check(over_one.result.ok and over_two.result.ok and await requests_count(over) == 2 and number(section(caches(), "bytes"), "evictions") >= 1
    and number(section(caches(), "bytes"), "bytes") <= int(section(caches(), "bytes").get("totalLimit", 0)),
    "bytes/A response over the limit of one entry is still a successful prefetch, but is downloaded again the next time", true)
  checkpoint("after-byte-lru")
  stages.byteCache = {"bytes": section(caches(), "bytes")}

func clear_stage() -> void:
  var c1 := "$http/pic/max-age/quad24.png?c1"
  var before := await requests_count(c1)
  memory_op("memory-2")
  var absent := await query_op("q-3", [c1])
  var again := await view_op("c1-after-clear", c1)
  check(equal(absent.result.value, {}) and again.served == "network" and await requests_count(c1) == before + 1,
    "memory/After the memory warning nothing is cached: queryCache finds nothing and the next Image asks the server again", true)
  stages.clear = {"caches": caches()}

func stop_stage() -> void:
  collect_jobs()
  # A download that has finished and is being decoded (held at the gate), two that are mid-body, two that have had no answer and
  # one that waits for a slot: stopping must end all of it.
  run_js("limit(1)")
  run_js("hold(true)")
  mount_image("stop-decode", square("$http/pic/plain/quad24.png?stop"))
  var decoding := await wait_until(func() -> bool: return int(loader().get("inFlight", 0)) == 1 and int(loader().get("atGate", 0)) == 1)
  for name: String in ["stop-body-1", "stop-body-2"]:
    mount_image(name, square("$http/hang-body/" + name))
  for name: String in ["stop-head-1", "stop-head-2", "stop-head-3"]:
    mount_image(name, square("$http/hang-head/" + name))
  var held := true
  for name: String in ["stop-body-1", "stop-body-2", "stop-head-1", "stop-head-2"]:
    held = held and await wait_for_hold(name, "waiting")
  var full := await wait_until(func() -> bool: return number(network(), "active") == 4 and number(network(), "queued") == 1)
  await wait_until(func() -> bool: return not events_of("stop-body-1", "progress").is_empty() and not events_of("stop-body-2", "progress").is_empty())
  var before := loader()
  var logs_before: Dictionary = react().logs
  stages.beforeStop = {"loader": before, "held": held}
  check(decoding and held and full and int(before.get("inFlight", 0)) == 1 and int(before.get("atGate", 0)) == 1,
    "stop/A decode and four downloads are in flight, and one more waits for a slot, when the application stops", true)
  application.call("stop")
  # The views of the stopped roots let go of their pictures as the engine frees them.
  await wait_until(func() -> bool: return live_textures() == 0)
  var stopped := native(application)
  var final := section(stopped, "images")
  var final_network := section(final, "network")
  var transport := section(final_network, "transport")
  var gone := true
  for name: String in ["stop-body-1", "stop-body-2", "stop-head-1", "stop-head-2"]:
    gone = gone and await wait_for_hold(name, "closed-by-client")
  var never := await hold_state("stop-head-3")
  var zero := ["pending", "inFlight", "finished", "ready", "fresh", "downloading", "liveTextures"].all(func(key: String) -> bool: return int(final.get(key, -1)) == 0)
  var counters_done := section(final, "counters")
  var final_caches := section(final, "caches")
  check(bool(stopped.get("stopped", false)) and zero and number(final_network, "active") == 0 and number(final_network, "queued") == 0 and number(transport, "active") == 0
    and int(counters_done.get("tasksStarted", -1)) == int(counters_done.get("tasksAwaited", -2)) and number(section(final_caches, "decoded"), "entries") == 0 and number(section(final_caches, "bytes"), "entries") == 0,
    "stop/Stopping ends every download and decode: every counter of the loader and the transport is zero, every task was awaited, and no picture or response is kept", true)
  check(gone and never == "none", "stop/The server saw each started request closed by the client, and never saw the one that waited", true)
  var unchanged: bool = react().logs == logs_before
  stages.afterStop = {"application": stopped, "loader": final, "logsBefore": logs_before, "logsAfter": react().logs}
  check(unchanged, "stop/Nothing reached JS after the stop: no Image was told of a load or an error", true)

func _initialize() -> void:
  var arguments := OS.get_cmdline_user_args()
  allow_original_negative = arguments.has("--allow-original-negative")
  sabotage = arguments.has("--sabotage")
  for argument: String in arguments:
    if argument.begins_with("--ports="):
      ports = JSON.parse_string(argument.trim_prefix("--ports="))
    elif argument.begins_with("--ca="):
      authority = FileAccess.get_file_as_string(argument.trim_prefix("--ca="))
  call_deferred("run_probe")

func run_probe() -> void:
  root.content_scale_size = Vector2i.ZERO
  root.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
  root.size = Vector2i(2200, 1700)
  root.content_scale_factor = SCALE
  await frames(2)
  manifest = JSON.parse_string(FileAccess.get_file_as_string(FIXTURE_DIR + "manifest.json"))
  inputs = {"http": base("http"), "https": base("https"), "other": base("other"), "refused": "http://127.0.0.1:" + str(int(ports.refused))}
  application = ClassDB.instantiate("FabricApplication")
  application.name = "NetworkApplication"
  application.set_meta("scenario", "images-fixture")
  application.set_meta(TRUST_META, authority)
  application.set("bundle_path", "res://build/images-network-probe.js")
  root.add_child(application)
  surface = mount_surface("A", "ImagesNetwork", Vector2(0, 0), Vector2(1100, 760), inputs)
  await wait_until(func() -> bool: return int(react().get("mounts", {}).get("ok", 0)) >= 1 or allow_original_negative, 300000)
  declared = js_json("ImagesNetwork.declared()")
  await wait_until(func() -> bool: return idle(declared.size()) or allow_original_negative)
  await frames(10)
  collect_jobs()
  mount_stage()
  await loads_stage()
  await requests_stage()
  await failures_stage()
  threads_stage()
  if allow_original_negative:
    # The preceding host has no network images: what it does with them is the control, and the rest of the stages need the server's holds.
    await memory_stage()
    await api_stage()
    stages.beforeStop = {"loader": loader()}
    application.call("stop")
    await frames(4)
    stages.afterStop = {"application": native(application), "loader": section(native(application), "images")}
    finish(false)
    return
  await concurrency_stage()
  await partial_stage()
  await cancel_stage()
  await limits_stage()
  await idle_stage()
  await memory_stage()
  await decoded_stage()
  await shared_stage()
  await api_stage()
  await uncacheable_stage()
  await credentials_stage()
  await expiry_stage()
  await limits_of_the_caches_stage()
  await byte_cache_stage()
  await clear_stage()
  collect_jobs()
  stages.ops = ops
  stages.jobs = jobs_since(0)
  await stop_stage()
  check(errors().is_empty(), "cleanup/No host or runtime diagnostic was reported")
  finish(false)

func finish(stop_first: bool = true) -> void:
  if stop_first:
    application.call("stop")
    await frames(4)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected_failures := expected_original_failures.duplicate()
  observed.sort()
  expected_failures.sort()
  var original_negative_observed := allow_original_negative and observed == expected_failures and not failures.is_empty()
  var report := {"scenario": "images-network", "reactNative": "0.87.1", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "checks": checks, "stages": stages, "expectedOriginalFailures": expected_original_failures, "scale": SCALE, "inputs": inputs, "ports": ports,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed, "sabotage": sabotage,
    "allCurrentAssertionsPassed": failures.is_empty()}
  var output := FileAccess.open("res://build/images-network-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The network images report is saved"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  var verdict := "IMAGES_NETWORK_SABOTAGE_REJECTED: " + str(failures.size()) if sabotage and not failures.is_empty() else "IMAGES_NETWORK_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "IMAGES_NETWORK_PASSED: " + str(checks.size()) if failures.is_empty() else "IMAGES_NETWORK_FAILED"
  print(verdict)
  quit(0 if failures.is_empty() or original_negative_observed or (sabotage and not failures.is_empty()) else 1)
