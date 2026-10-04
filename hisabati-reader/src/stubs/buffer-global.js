// mdb-reader uses Node's global Buffer; provide it in the browser.
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;
