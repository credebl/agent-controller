import { createPrivateKey, KeyObject } from 'crypto';

/**
 * Extracts the raw private key (hex) from a PEM-encoded EC (P-256) private key.
 */
async function pemToRawEcPrivateKey(pem: string): Promise<string> {
  const keyObj: KeyObject = createPrivateKey({
    key: pem,
    format: 'pem',
  });

  // Extract raw private key (as Buffer)
  const rawPrivateKey = keyObj.export({
    format: 'jwk',
  }).d!;

  return Buffer.from(rawPrivateKey, 'base64').toString('hex');
}

/**
 * Extracts the raw private key (hex) from a PEM-encoded Ed25519 private key.
 */
export async function pemToRawEd25519PrivateKey(pem: string): Promise<string> {
    const keyObj: KeyObject = createPrivateKey({
      key: pem.replace(/\\n/g, '\n'),
      format: 'pem',
    });
  
    // Ed25519 JWK exports the *seed* (first 32 bytes of the private key)
    const jwk = keyObj.export({ format: 'jwk' });
    if (!jwk.d) throw new Error("Not an Ed25519 private key");

    console.log(`JWK DETAILS-----------> ${JSON.stringify(jwk,null,2)}`)
  
    return Buffer.from(jwk.d, 'base64').toString('hex');
  }
  

// Example usage
// const pemP256 = `
// -----BEGIN PRIVATE KEY-----
// MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgnMryIV0XOLN4wtdX
// XjCFe2CthJA2ecvu7jmgRmD+N6KgCgYIKoZIzj0DAQehRANCAAQqVrIgPFQwSNmG
// zUf0nOp4mCIJ4Zy9Ckn4q//2yN9oPQPJ/aCZmKTY7Wvieez63ZAxD3xC+XPQLCwB
// i2r/6QL+
// -----END PRIVATE KEY-----
// `.trim();

//pemToRawEcPrivateKey(pemP256).then(console.log);
// Output: "9ccaf2215d1738b378c2d7575e30857b60ad84903679cbeeee39a04660fe37a2"


// Example usage
// const pemEd25519 = `
// -----BEGIN PRIVATE KEY-----
// MC4CAQAwBQYDK2VwBCIEICs3+innp/FXE74I6qk9nLz4gLY/9e9IFUTUm+ytzV9o
// -----END PRIVATE KEY-----
// `.trim();


//pemToRawEd25519PrivateKey(pemEd25519).then(console.log);
// Output: "4cd74aec18805f10c107c3e4aed2d4a07bbd99bc2c6ed9abb3f9b90cd180cfb7"