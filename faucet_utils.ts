import { BITBOX } from "bitbox-sdk";
import * as slpjs from "slpjs";
import { BchdNetwork, BchdValidator } from "slpjs";
import { BigNumber } from "bignumber.js";

const firstNames = require('./jnames/female.json');
const surNames = require('./jnames/surnames.json');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FaucetUtils {
    public network: BchdNetwork;

    constructor (bitbox: BITBOX, validator: BchdValidator) {
        this.network = new BchdNetwork({ BITBOX: bitbox, validator, logger: console, client: validator.client });
    }

    public async nftTokenSend(tokenId: string, inputUtxos: slpjs.SlpAddressUtxoResult[], tokenReceiverAddress: string, paymentAddress: string, paymentAddressWif: string): Promise<string> {
        let burnUtxo: slpjs.SlpAddressUtxoResult | undefined = undefined;
        inputUtxos.forEach((txo) => {
            if (!burnUtxo && txo.slpUtxoJudgement === 'SLP_TOKEN' && txo.slpUtxoJudgementAmount.isEqualTo(1)) {
                burnUtxo = txo;
            }
        })
        // ---[ TODO: optimize this part to send both transactions with one call ]---
        if (!burnUtxo) {
            const burnTxHex = await this.network.txnHelpers.simpleTokenSend({
                tokenId,
                sendAmounts: [ new BigNumber(1) ],
                inputUtxos,
                tokenReceiverAddresses: [ paymentAddress ],
                changeReceiverAddress: paymentAddress
            })
            const burnTxId: string = await this.network.sendTx(burnTxHex);
            console.log(`burn tx: ${burnTxId}`);
            console.log(`wait sync...`);
            await sleep(3000);
        }

        const balances: slpjs.SlpBalancesResult = (await this.network.getAllSlpBalancesAndUtxos(paymentAddress) as slpjs.SlpBalancesResult);
        balances.slpTokenUtxos[tokenId].forEach((txo) => {
            if (!burnUtxo && txo.slpUtxoJudgementAmount.isEqualTo(1)) {
                burnUtxo = txo;
            }
        });
        if (!burnUtxo) throw new Error('No token ready for burn');

        const inputs = [burnUtxo, ...balances!.nonSlpUtxos] as slpjs.SlpAddressUtxoResult[];
        inputs.forEach((j) => j.wif = paymentAddressWif);

        const name = firstNames[Math.floor(Math.random() * firstNames.length)] + " " + surNames[Math.floor(Math.random() * surNames.length)];
        const ticker = process.env.NFTTICKER! || "SFNFT";
        const documentUri: string|null = process.env.DOCUMENTURI || null;
        const documentHash: Buffer|null = process.env.DOCUMENTHASH ? Buffer.from(process.env.DOCUMENTHASH, 'hex') : null;

        const genesisTxHex = this.network.txnHelpers.simpleNFT1ChildGenesis({
            nft1GroupId: tokenId,
            tokenName: name,
            tokenTicker: ticker,
            documentUri,
            documentHash,
            tokenReceiverAddress: tokenReceiverAddress,
            bchChangeReceiverAddress: paymentAddress,
            inputUtxos: inputs
          })
        // console.log(`genesis hex: ${JSON.stringify(genesisTxHex, null, 2)}`)
        const burn = {
            tokenId: Buffer.from(tokenId, 'hex'),
            tokenType: 129,
            amount: '1',
            outpointHash: Buffer.from(Buffer.from(burnUtxo!.txid, 'hex').reverse()),
            outpointVout: burnUtxo!.vout
        }

        const genesisTxId = await this.network.sendTx(genesisTxHex, [burn]);
        console.log('NFT1 Child GENESIS txn complete: ', genesisTxId);
        return genesisTxId;
    }
}
