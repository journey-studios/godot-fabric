#pragma once

#include <godot_cpp/classes/tls_options.hpp>
#include <godot_cpp/classes/x509_certificate.hpp>
#include <godot_cpp/variant/string.hpp>
#include <optional>
#include <string>

namespace fabric_godot {
// The client-side TLS options of a secure connection, shared by the HTTP and WebSocket transports: Godot's default roots
// when the application supplies no authorities, and otherwise exactly the certificate authorities it supplies as PEM. Text
// that is no certificate at all is refused here: the engine would parse it and print an error, and trusting nothing but
// that text must never fall back to trusting everything. Returns the explanation of a refusal.
inline std::optional<std::string> client_tls_options(const std::string &authorities, godot::Ref<godot::TLSOptions> &options) {
  if (authorities.empty()) {
    options = godot::TLSOptions::client();
    return std::nullopt;
  }
  godot::Ref<godot::X509Certificate> chain;
  chain.instantiate();
  if (authorities.find("-----BEGIN CERTIFICATE-----") == std::string::npos ||
      chain->load_from_string(godot::String::utf8(authorities.c_str(), static_cast<int64_t>(authorities.size()))) != godot::OK)
    return "E_TLS_TRUST: the trusted certificate authorities are not valid PEM";
  options = godot::TLSOptions::client(chain);
  return std::nullopt;
}
}
