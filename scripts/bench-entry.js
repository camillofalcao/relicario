import { derive, createRelicario, makeRandom, DEFAULT_KDF } from '../src/core/crypto.js';
import { evaluatePassword, generatePassphrase } from '../src/core/password.js';
import { runSelfTest } from '../src/core/selftest.js';
import { scanImageData } from '../src/ui/scanner.js';
import { encodeContentBlocks } from '../src/core/format.js';
import * as base45 from '../src/core/base45.js';
import { qrSvg } from '../src/ui/qr.js';
window.B = { derive, createRelicario, makeRandom, DEFAULT_KDF, evaluatePassword, generatePassphrase, runSelfTest, scanImageData, encodeContentBlocks, base45, qrSvg };
