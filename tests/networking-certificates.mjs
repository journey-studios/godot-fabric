import {generateKeyPairSync, randomBytes, sign} from "node:crypto";

// Test certificates for the networking suite, built in memory from Node's own
// crypto: a root CA and a leaf it signs for localhost and 127.0.0.1. Node can
// parse certificates but not create them, so this writes the small X.509 v3
// subset a TLS client needs (DER, sha256WithRSAEncryption). Nothing here is
// committed as data: every run generates fresh keys, and only the public CA
// certificate is ever written to disk (build/), for the Godot probe to trust.

const derLength = length => {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) {
    bytes.unshift(rest % 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag, ...parts) => {
  const content = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
};
const sequence = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const integer = bytes => {
  // Minimal two's complement, positive.
  let value = Buffer.from(bytes);
  while (value.length > 1 && value[0] === 0 && (value[1] & 0x80) === 0) {
    value = value.subarray(1);
  }
  return tlv(0x02, (value[0] & 0x80) === 0 ? value : Buffer.concat([Buffer.from([0]), value]));
};
const oid = dotted => {
  const arcs = dotted.split(".").map(Number);
  const bytes = [40 * arcs[0] + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const group = [arc & 0x7f];
    for (let rest = arc >> 7; rest > 0; rest >>= 7) {
      group.unshift((rest & 0x7f) | 0x80);
    }
    bytes.push(...group);
  }
  return tlv(0x06, Buffer.from(bytes));
};
const utf8String = text => tlv(0x0c, Buffer.from(text, "utf8"));
const utcTime = date => {
  const two = value => String(value).padStart(2, "0");
  return tlv(0x17, Buffer.from(`${two(date.getUTCFullYear() % 100)}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${
    two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`, "ascii"));
};
const bitString = (bytes, unusedBits = 0) => tlv(0x03, Buffer.from([unusedBits]), bytes);
const octetString = bytes => tlv(0x04, bytes);
const boolean = value => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const contextual = (tag, ...parts) => tlv(0xa0 | tag, ...parts);

const rsaWithSha256 = sequence(oid("1.2.840.113549.1.1.11"), tlv(0x05, Buffer.alloc(0)));
const name = commonName => sequence(set(sequence(oid("2.5.4.3"), utf8String(commonName))));
const extension = (id, critical, value) => sequence(oid(id), ...(critical ? [boolean(true)] : []), octetString(value));

function certificate({subject, issuer, publicKey, signingKey, authority, names}) {
  const now = Date.now();
  const extensions = [
    extension("2.5.29.19", true, sequence(...(authority ? [boolean(true)] : []))),
    // keyCertSign and cRLSign for the authority; digitalSignature and keyEncipherment for the leaf.
    extension("2.5.29.15", true, authority ? bitString(Buffer.from([0x06]), 1) : bitString(Buffer.from([0xa0]), 5)),
  ];
  if (!authority) {
    extensions.push(extension("2.5.29.37", false, sequence(oid("1.3.6.1.5.5.7.3.1"))));
    // dNSName is [2] and iPAddress is [7], both primitive.
    extensions.push(extension("2.5.29.17", false, sequence(...names.dns.map(host => tlv(0x82, Buffer.from(host, "ascii"))),
      ...names.ips.map(address => tlv(0x87, Buffer.from(address))))));
  }
  const toBeSigned = sequence(
    contextual(0, integer(Buffer.from([2]))),
    integer(Buffer.concat([Buffer.from([0x01]), randomBytes(15)])),
    rsaWithSha256,
    name(issuer),
    sequence(utcTime(new Date(now - 24 * 3600 * 1000)), utcTime(new Date(now + 48 * 3600 * 1000))),
    name(subject),
    publicKey.export({type: "spki", format: "der"}),
    contextual(3, sequence(...extensions)));
  const signature = sign("sha256", toBeSigned, signingKey);
  return sequence(toBeSigned, rsaWithSha256, bitString(signature)).toString("base64").match(/.{1,64}/g)
    .reduce((pem, line) => pem + line + "\n", "-----BEGIN CERTIFICATE-----\n") + "-----END CERTIFICATE-----\n";
}

// One authority and one server identity signed by it. The key is exported as
// PKCS#8 text only to hand it to Node's own TLS server.
export function issueTestIdentity(authorityName = "Godot Fabric networking test CA") {
  const authorityKeys = generateKeyPairSync("rsa", {modulusLength: 2048});
  const leafKeys = generateKeyPairSync("rsa", {modulusLength: 2048});
  const authorityPem = certificate({subject: authorityName, issuer: authorityName, publicKey: authorityKeys.publicKey,
    signingKey: authorityKeys.privateKey, authority: true});
  const leafPem = certificate({subject: "localhost", issuer: authorityName, publicKey: leafKeys.publicKey,
    signingKey: authorityKeys.privateKey, authority: false,
    names: {dns: ["localhost"], ips: [Buffer.from([127, 0, 0, 1])]}});
  return {authorityCertificate: authorityPem, certificate: leafPem, privateKey: leafKeys.privateKey.export({type: "pkcs8", format: "pem"})};
}
