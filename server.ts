import * as dotenv from "dotenv";
dotenv.config();

import beliefs from './beliefs';
import facets  from './facets';
import body    from './body';
import soul    from './soul';

import * as express from "express";
import * as crypto from "crypto";
import axios from "axios";
const rateLimit = require("express-rate-limit");
const { verify } = require('hcaptcha');
const app = express();

app.set('trust proxy', 1);

const apiLimiter = rateLimit({
  windowMs: 3 * 60 * 1000, // 1 minute
  max: 3,
  draft_polli_ratelimit_headers: true,
});


import BigNumber from "bignumber.js";
import * as bodyParser from "body-parser";
import * as slpjs from "slpjs";
import { SlpFaucetHandler } from "./slpfaucet";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const slpFaucet = new SlpFaucetHandler(process.env.MNEMONIC!);
const faucetQty = parseInt(process.env.TOKENQTY!);


const successive_generator = function* (tokenid: string): any {
    let b = tokenid;

    while (true) {
        yield new BigNumber('0x'+b);
        b = crypto.createHash('sha256').update(b).digest().toString('hex');
    }
};

const extract_remainder = (big: BigNumber, modulus: number): number => {
    return big.modulo(modulus).toNumber();
}

const get_phrase_id_from_v = (v: number, mid: number): number => {
    if (mid === 3) {
        return v === 0 ? 0
             : v <   6 ? 1
             : v <  29 ? 2
             : v < 222 ? 3
             : v < 250 ? 4
             : v < 255 ? 5
             :           6;
    }
    
    if (mid === 4) {
        return v === 0 ? 0
             : v <   3 ? 1
             : v <   8 ? 2
             : v <  29 ? 3
             : v < 222 ? 4
             : v < 247 ? 5
             : v < 252 ? 6
             : v < 255 ? 7
             :           8;
    }

    return -1;
};
  
const generate_npc = (tokenid: string): any => {
    const it = successive_generator(tokenid);
    
    let ret: any = {};

    ret['beliefs'] = {};
    for (let k of Object.keys(beliefs)) {
        const v = extract_remainder(it.next().value, 256);
        ret['beliefs'][k] = v;
    }

    ret['facets'] = {};
    for (let k of Object.keys(facets)) {
        const v = extract_remainder(it.next().value, 256);
        ret['facets'][k] = v;
    }

    ret['body'] = {};
    for (let k of Object.keys(body)) {
        const v = extract_remainder(it.next().value, 256);
        ret['body'][k] = v;
    }

    ret['soul'] = {};
    for (let k of Object.keys(soul)) {
        const v = extract_remainder(it.next().value, 256);
        ret['soul'][k] = v;
    }

    return ret;
};

const extract_phrases = (npc_phrase_obj: any, phrases: any, mid: number) => {
    let ret = [];
  
    for (let k of Object.keys(npc_phrase_obj)) {
        const phrase_id: number = get_phrase_id_from_v(npc_phrase_obj[k], mid);
        if (phrase_id != mid) {
            ret.push(phrases[k][phrase_id]);
        }
    }
  
    return ret;
};

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.set("view engine", "ejs");

app.get("/", (req, res) => {
	res.render("index", { txid: null, error: null });
});

app.post("/", apiLimiter, async (req, res) => {
    const address = req.body.address;

    if (address === process.env.DISTRIBUTE_SECRET!) {

        try {
            await slpFaucet.evenlyDistributeTokens(process.env.TOKENID!);
        } catch (err) {
            console.log(err);
            res.render("index", { txid: null, error: err.message });
            return;
        }
        
        try {
            await slpFaucet.evenlyDistributeBch();
        } catch (err) {
            console.log(err);
            res.render("index", { txid: null, error: err.message });
            return;
        }
        slpFaucet.currentFaucetAddressIndex = 0;
        res.render("index", { txid: null, error: "Token distribution instantiated..." });
        return;
    }

    try {
        if (!slpjs.Utils.isSlpAddress(address)) {
            res.render("index", { txid: null, error: "Not a SLP Address." });
            return;
        }
    } catch (error) {
        res.render("index", { txid: null, error: "Not a SLP Address." });
        return;
    }

    console.log(req.body);

    try {
        const verifyData = await verify(process.env.HCAPTCHA_SECRET, req.body["h-captcha-response"])
        console.log(verifyData);
        if (! verifyData.success) {
            throw new Error('captcha verification failed');
        }
    } catch (e) {
        res.render("index", { txid: null, error: e.message });
        return;
    }

    let changeAddr: { address: string, balance: slpjs.SlpBalancesResult };
    try {
        changeAddr = await slpFaucet.selectFaucetAddressForTokens(process.env.TOKENID!);
    } catch (error) {
        res.render("index", { txid: null, error: "Faucet is temporarily empty :(" });
        return;
    }

    let sendTxId: string;
    try {
        let inputs: slpjs.SlpAddressUtxoResult[] = [];
        inputs = inputs.concat(changeAddr.balance.slpTokenUtxos[process.env.TOKENID!]).concat(changeAddr.balance.nonSlpUtxos);
        inputs.map((i) => i.wif = slpFaucet.wifs[changeAddr.address]);
        sendTxId = await slpFaucet.tokenSend(process.env.TOKENID!, new BigNumber(faucetQty), inputs, address, changeAddr.address);
    } catch (error) {
        console.log(error);
        res.render("index", { txid: null, error: "Server error." });
        return;
    }
    console.log(sendTxId);
    const re = /^([A-Fa-f0-9]{2}){32,32}$/;
    if (typeof sendTxId !== "string" || !re.test(sendTxId)) {
        res.render("index", { txid: null, error: sendTxId });
        return;
    }

    res.render("index", { txid: sendTxId, error: null });
});

app.get("/waifu/:tokenIdHex", async (req, res) => {
    const q = {
      "v": 3,
      "q": {
        "db": ["g"],
        "find": {
          "graphTxn.txid": req.params.tokenIdHex
        },
        "limit": 1
      }
    };
    const url = `https://slpdb.fountainhead.cash/q/${Buffer.from(JSON.stringify(q)).toString('base64')}`;
    const resp = await axios.get(url);
    if (resp.data.g.length === 0) {
        // not found
    }

    const slpdata = resp.data.g[0].graphTxn.details;
    const name = slpdata.name;

    const npc = generate_npc(req.params.tokenIdHex);

    let data: any = {};
    data.beliefs = extract_phrases(npc.beliefs, beliefs, 3);
    data.facets  = extract_phrases(npc.facets,  facets,  3);
    data.body    = extract_phrases(npc.body,    body,    4);
    data.soul    = extract_phrases(npc.soul,    soul,    4);

	res.render("waifu", {
        tokenid: req.params.tokenIdHex,
        name,
        npc,
        data,
    });
});


app.listen(process.env.PORT, () => {
    console.log("SLP faucet server listening on port " + process.env.PORT + "!");
});
