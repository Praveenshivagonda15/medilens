

function bufToHex(buffer) {
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

function hexToBuf(hexString) {
  const bytes = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexString.substr(i * 2, 2), 16);
  }
  return bytes.buffer;
}

async function deriveKey(pin, salt) {
  const encoder = new TextEncoder();
  const pinBytes = encoder.encode(pin);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    pinBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptData(plaintext, pin) {
  try {
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(plaintext);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const key = await deriveKey(pin, salt);

    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      dataBytes
    );

    const saltHex = bufToHex(salt);
    const ivHex = bufToHex(iv);
    const ciphertextHex = bufToHex(ciphertext);

    return `${saltHex}:${ivHex}:${ciphertextHex}`;
  } catch (err) {
    console.error("Encryption failed:", err);
    throw new Error("Zero-Knowledge Encryption failed.");
  }
}

export async function decryptData(packedCiphertext, pin) {
  try {
    const parts = packedCiphertext.split(':');
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted format.");
    }

    const salt = new Uint8Array(hexToBuf(parts[0]));
    const iv = new Uint8Array(hexToBuf(parts[1]));
    const ciphertext = hexToBuf(parts[2]);

    const key = await deriveKey(pin, salt);

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (err) {
    console.error("Decryption failed:", err);
    throw new Error("Incorrect PIN or tampered cryptographic storage.");
  }
}
