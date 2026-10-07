#pragma once

#include "http_transport.h"
#include <functional>
#include <memory>
#include <string>

namespace fabric_godot {
// The PEM text of the certificate authorities an HTTPS connection trusts
// instead of Godot's default roots, or "" to keep those. The application's
// validation seam supplies it and it is read for each new TLS connection.
using TrustedAuthorities = std::function<std::string()>;
// Monotonic milliseconds; the deadlines of timed requests are measured on it.
using MonotonicClock = std::function<double()>;

// HTTP/1.1 over Godot's HTTPClient, one client and one connection per request,
// polled from the application's pump. Godot's client performs neither redirects,
// total timeouts, compression, cookies, pooling nor HTTP/2, so the transport
// follows redirects itself (http_core.h's OkHttp rules) and enforces the
// request's deadline with its own clock; compressed responses fail explicitly.
std::unique_ptr<HttpTransport> make_godot_http_transport(
    TrustedAuthorities trusted_authorities = {}, MonotonicClock now = {});
}
