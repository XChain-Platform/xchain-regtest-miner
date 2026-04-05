/**
 * Seam C Integration Tests: fillMempool ↔ bitcoinjs-lib (PSBT Pipeline)
 *
 * These tests use REAL crypto libraries with NO mocking of BIP39/BIP32/bitcoinjs-lib.
 * Only the BlockchainConnector is mocked (to avoid needing a real Bitcoin node).
 * A fixed mnemonic makes all keys and addresses deterministic.
 */

const assert = require('assert')
const sinon = require('sinon')
const {
    MNEMONIC, network, account, mainKeyNode, MAIN_ADDRESS,
    OUTPUTS_QUANTITY_PER_TX, AMOUNT_FOR_EACH_ADDRESS, FEE, SATOSHI_UNIT,
    deriveChildKey, deriveChildAddress, createFundingTx, chunkFundingAmount,
    bitcoin, bip39, bip32, ecc,
} = require('./helpers/fixtures')

const BlockchainConnector = require('../../src/BlockchainConnector')
const { ECPairFactory } = require('ecpair')

describe('Seam C: fillMempool ↔ bitcoinjs-lib crypto pipeline', function () {

    // ─── Key Derivation ─────────────────────────────────────────────────

    describe('key derivation from fixed mnemonic', function () {
        it('produces a valid P2PKH regtest main address', function () {
            assert.ok(MAIN_ADDRESS.startsWith('m') || MAIN_ADDRESS.startsWith('n'),
                `Expected P2PKH regtest address (m/n prefix), got: ${MAIN_ADDRESS}`)
        })

        it('derives unique child addresses', function () {
            const addresses = []
            for (let i = 0; i < 5; i++) {
                addresses.push(deriveChildAddress(i))
            }
            const unique = new Set(addresses)
            assert.strictEqual(unique.size, 5, 'All 5 child addresses must be unique')
        })

        it('derives valid P2PKH regtest child addresses', function () {
            for (let i = 0; i < 5; i++) {
                const addr = deriveChildAddress(i)
                assert.ok(addr.startsWith('m') || addr.startsWith('n'),
                    `Child address ${i} should be P2PKH regtest, got: ${addr}`)
            }
        })

        it('main address uses derivation path m/44h/0h/0h/0 → derive(0) → derive(0)', function () {
            // Independently re-derive and compare
            const seed = bip39.mnemonicToSeedSync(MNEMONIC)
            const root = bip32.fromSeed(seed)
            const acct = root.derivePath("m/44'/0'/0'/0")
            const key = acct.derive(0).derive(0)
            const addr = bitcoin.payments.p2pkh({ pubkey: key.publicKey, network }).address
            assert.strictEqual(addr, MAIN_ADDRESS)
        })

        it('child address at index i uses derive(i+1).derive(0)', function () {
            // Verify the offset: fillMempool uses account.derive(i+1).derive(0)
            const key0 = account.derive(1).derive(0)
            const addr0 = bitcoin.payments.p2pkh({ pubkey: key0.publicKey, network }).address
            assert.strictEqual(addr0, deriveChildAddress(0))

            const key2 = account.derive(3).derive(0)
            const addr2 = bitcoin.payments.p2pkh({ pubkey: key2.publicKey, network }).address
            assert.strictEqual(addr2, deriveChildAddress(2))
        })
    })

    // ─── UTXO Identification ────────────────────────────────────────────

    describe('UTXO identification from raw transaction', function () {
        it('finds the output matching the main address at index 0', function () {
            const funding = createFundingTx(MAIN_ADDRESS, 2050)
            const tx = bitcoin.Transaction.fromHex(funding.hex)

            let utxoIndex = 0
            let found = false
            for (const out of tx.outs) {
                const addr = bitcoin.address.fromOutputScript(out.script, network)
                if (addr === MAIN_ADDRESS) {
                    found = true
                    break
                }
                utxoIndex++
            }

            assert.ok(found, 'Should find mainAddress output')
            assert.strictEqual(utxoIndex, 0, 'mainAddress output should be at index 0')
        })

        it('finds the correct output when mainAddress is not at index 0', function () {
            // Build a tx with a different address at index 0, mainAddress at index 1
            const otherAddr = deriveChildAddress(0)
            const tx = new bitcoin.Transaction()
            tx.version = 2
            const dummyHash = Buffer.alloc(32, 0)
            dummyHash[0] = 0x02
            tx.addInput(dummyHash, 0)
            tx.addOutput(bitcoin.address.toOutputScript(otherAddr, network), 1000)
            tx.addOutput(bitcoin.address.toOutputScript(MAIN_ADDRESS, network), 2050)
            const hex = tx.toHex()

            const parsed = bitcoin.Transaction.fromHex(hex)
            let utxoIndex = 0
            for (const out of parsed.outs) {
                const addr = bitcoin.address.fromOutputScript(out.script, network)
                if (addr === MAIN_ADDRESS) break
                utxoIndex++
            }

            assert.strictEqual(utxoIndex, 1, 'mainAddress output should be at index 1')
        })

        it('correctly identifies UTXOs across multiple funding transactions', function () {
            const funding1 = createFundingTx(MAIN_ADDRESS, 2050)
            const funding2 = createFundingTx(MAIN_ADDRESS, 4100)

            const utxos = []
            for (const funding of [funding1, funding2]) {
                const tx = bitcoin.Transaction.fromHex(funding.hex)
                let utxoIndex = 0
                for (const out of tx.outs) {
                    const addr = bitcoin.address.fromOutputScript(out.script, network)
                    if (addr === MAIN_ADDRESS) {
                        utxos.push({ txid: funding.txid, utxoIndex, value: out.value })
                        break
                    }
                    utxoIndex++
                }
            }

            assert.strictEqual(utxos.length, 2)
            assert.strictEqual(utxos[0].value, 2050)
            assert.strictEqual(utxos[1].value, 4100)
            assert.notStrictEqual(utxos[0].txid, utxos[1].txid)
        })
    })

    // ─── PSBT Construction and Signing ──────────────────────────────────

    describe('distribution PSBT (main address → child addresses)', function () {
        let fundingTx, psbt

        beforeEach(function () {
            // Create a funding tx with enough value for 3 child addresses
            const amountSats = (AMOUNT_FOR_EACH_ADDRESS + FEE) * 3 + 50 * 3 // 6150
            fundingTx = createFundingTx(MAIN_ADDRESS, amountSats)
        })

        it('constructs a valid PSBT with correct input', function () {
            psbt = new bitcoin.Psbt({ network })
            psbt.addInput({
                hash: fundingTx.txid,
                index: 0,
                nonWitnessUtxo: Buffer.from(fundingTx.hex, 'hex'),
            })

            assert.strictEqual(psbt.data.inputs.length, 1)
        })

        it('adds correct number of outputs with correct values', function () {
            psbt = new bitcoin.Psbt({ network })
            psbt.addInput({
                hash: fundingTx.txid,
                index: 0,
                nonWitnessUtxo: Buffer.from(fundingTx.hex, 'hex'),
            })

            for (let i = 0; i < 3; i++) {
                const childAddr = deriveChildAddress(i)
                psbt.addOutput({
                    address: childAddr,
                    value: AMOUNT_FOR_EACH_ADDRESS + FEE, // 2000
                })
            }

            assert.strictEqual(psbt.data.outputs.length, 3)
        })

        it('signs and finalizes successfully with the main key', function () {
            psbt = new bitcoin.Psbt({ network })
            psbt.addInput({
                hash: fundingTx.txid,
                index: 0,
                nonWitnessUtxo: Buffer.from(fundingTx.hex, 'hex'),
            })

            for (let i = 0; i < 3; i++) {
                psbt.addOutput({
                    address: deriveChildAddress(i),
                    value: AMOUNT_FOR_EACH_ADDRESS + FEE,
                })
            }

            const ECPair = ECPairFactory(ecc)
            const keyToSign = ECPair.fromPrivateKey(mainKeyNode.privateKey, { network })
            psbt.signInput(0, keyToSign)
            psbt.finalizeAllInputs()

            const extractedTx = psbt.extractTransaction()
            assert.ok(extractedTx, 'Should extract a transaction')
        })

        it('produces valid serializable transaction hex', function () {
            psbt = new bitcoin.Psbt({ network })
            psbt.addInput({
                hash: fundingTx.txid,
                index: 0,
                nonWitnessUtxo: Buffer.from(fundingTx.hex, 'hex'),
            })

            for (let i = 0; i < 3; i++) {
                psbt.addOutput({
                    address: deriveChildAddress(i),
                    value: AMOUNT_FOR_EACH_ADDRESS + FEE,
                })
            }

            const ECPair = ECPairFactory(ecc)
            const keyToSign = ECPair.fromPrivateKey(mainKeyNode.privateKey, { network })
            psbt.signInput(0, keyToSign)
            psbt.finalizeAllInputs()

            const hex = psbt.extractTransaction().toHex()
            // Round-trip: parse the hex back
            const parsed = bitcoin.Transaction.fromHex(hex)
            assert.strictEqual(parsed.ins.length, 1)
            assert.strictEqual(parsed.outs.length, 3)
            // Each output should have value 2000
            for (const out of parsed.outs) {
                assert.strictEqual(out.value, 2000)
            }
        })
    })

    describe('stress PSBT (child address → main address)', function () {
        it('constructs, signs, and finalizes with a child key', function () {
            // First build the distribution tx to use as nonWitnessUtxo
            const fundingAmount = (AMOUNT_FOR_EACH_ADDRESS + FEE) * 1 + 50
            const fundingTx = createFundingTx(MAIN_ADDRESS, fundingAmount)

            const distPsbt = new bitcoin.Psbt({ network })
            distPsbt.addInput({
                hash: fundingTx.txid,
                index: 0,
                nonWitnessUtxo: Buffer.from(fundingTx.hex, 'hex'),
            })
            const childAddr = deriveChildAddress(0)
            distPsbt.addOutput({
                address: childAddr,
                value: AMOUNT_FOR_EACH_ADDRESS + FEE,
            })

            const ECPair = ECPairFactory(ecc)
            const mainKey = ECPair.fromPrivateKey(mainKeyNode.privateKey, { network })
            distPsbt.signInput(0, mainKey)
            distPsbt.finalizeAllInputs()
            const distTx = distPsbt.extractTransaction()
            const distHex = distTx.toHex()
            const distTxid = distTx.getId()

            // Now build the stress tx: child → main
            const stressPsbt = new bitcoin.Psbt({ network })
            stressPsbt.addInput({
                hash: distTxid,
                index: 0,
                sequence: 0xffffffff,
                nonWitnessUtxo: Buffer.from(distHex, 'hex'),
            })
            stressPsbt.addOutput({
                address: MAIN_ADDRESS,
                value: AMOUNT_FOR_EACH_ADDRESS,
            })

            const childKey = deriveChildKey(0)
            const childKeyPair = ECPair.fromPrivateKey(childKey.privateKey, { network })
            stressPsbt.signInput(0, childKeyPair)
            stressPsbt.finalizeAllInputs()

            const stressTx = stressPsbt.extractTransaction()
            const stressHex = stressTx.toHex()

            // Validate the stress tx structure
            const parsed = bitcoin.Transaction.fromHex(stressHex)
            assert.strictEqual(parsed.ins.length, 1, 'Stress tx should have 1 input')
            assert.strictEqual(parsed.outs.length, 1, 'Stress tx should have 1 output')
            assert.strictEqual(parsed.outs[0].value, AMOUNT_FOR_EACH_ADDRESS)
        })
    })

    describe('ECPair network parameter', function () {
        it('creates key pair with regtest network', function () {
            const ECPair = ECPairFactory(ecc)
            const keyPair = ECPair.fromPrivateKey(mainKeyNode.privateKey, { network })
            assert.ok(keyPair.publicKey, 'Should have a public key')
            assert.ok(keyPair.privateKey, 'Should have a private key')
            assert.deepStrictEqual(keyPair.network, bitcoin.networks.regtest)
        })

        it('produces the same address as direct P2PKH derivation', function () {
            const ECPair = ECPairFactory(ecc)
            const keyPair = ECPair.fromPrivateKey(mainKeyNode.privateKey, { network })
            const ecPairAddr = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address
            assert.strictEqual(ecPairAddr, MAIN_ADDRESS)
        })
    })

    // ─── Full fillMempool End-to-End ────────────────────────────────────

    describe('fillMempool end-to-end with real crypto', function () {
        let XChainRegtestMiner, miner, connectorStub
        let broadcastedTxHexes

        beforeEach(function () {
            // Stub generateMnemonic to return our fixed mnemonic
            sinon.stub(bip39, 'generateMnemonic').returns(MNEMONIC)
            sinon.stub(console, 'log')
            sinon.stub(console, 'error')

            // Compute the funding transaction for txQuantity=1
            const fundingAmount = chunkFundingAmount(1, 0) // 2050 sats
            const funding = createFundingTx(MAIN_ADDRESS, fundingAmount)

            broadcastedTxHexes = []

            connectorStub = {
                sendToAddress: sinon.stub().resolves(funding.txid),
                generateToAddress: sinon.stub().resolves(['blockhash']),
                getRawTransaction: sinon.stub().callsFake(async (txid) => {
                    if (txid === funding.txid) return funding.hex
                    return null
                }),
                sendRawTransaction: sinon.stub().callsFake(async (txHex) => {
                    broadcastedTxHexes.push(txHex)
                    // Return the real txid so stress txs can reference it
                    return bitcoin.Transaction.fromHex(txHex).getId()
                }),
            }

            // Clear module cache and load fresh
            delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
            XChainRegtestMiner = require('../../src/XChainRegtestMiner')
            miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
            miner.connector = connectorStub
            miner.walletAddress = 'bcrt1qreward'
            sinon.stub(miner, 'sleep').resolves()
        })

        afterEach(function () {
            sinon.restore()
            delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
        })

        it('fillMempool(1) completes without error', async function () {
            await miner.fillMempool(1)
        })

        it('fillMempool(1) sets keepMining to false', async function () {
            miner.keepMining = true
            await miner.fillMempool(1)
            assert.strictEqual(miner.keepMining, false)
        })

        it('fillMempool(1) broadcasts exactly 2 raw transactions', async function () {
            // 1 distribution tx + 1 stress tx
            await miner.fillMempool(1)
            assert.strictEqual(connectorStub.sendRawTransaction.callCount, 2,
                'Should broadcast 1 distribution tx + 1 stress tx')
        })

        it('fillMempool(1) distribution tx has correct structure', async function () {
            await miner.fillMempool(1)
            const distHex = broadcastedTxHexes[0]
            const distTx = bitcoin.Transaction.fromHex(distHex)

            assert.strictEqual(distTx.ins.length, 1, 'Distribution tx: 1 input')
            assert.strictEqual(distTx.outs.length, 1, 'Distribution tx: 1 output (for 1 child address)')
            assert.strictEqual(distTx.outs[0].value, AMOUNT_FOR_EACH_ADDRESS + FEE,
                'Output value should be AMOUNT + FEE = 2000')
        })

        it('fillMempool(1) stress tx has correct structure', async function () {
            await miner.fillMempool(1)
            const stressHex = broadcastedTxHexes[1]
            const stressTx = bitcoin.Transaction.fromHex(stressHex)

            assert.strictEqual(stressTx.ins.length, 1, 'Stress tx: 1 input')
            assert.strictEqual(stressTx.outs.length, 1, 'Stress tx: 1 output')
            assert.strictEqual(stressTx.outs[0].value, AMOUNT_FOR_EACH_ADDRESS,
                'Output value should be AMOUNT = 1000')
        })

        it('fillMempool(1) stress tx output goes to main address', async function () {
            await miner.fillMempool(1)
            const stressTx = bitcoin.Transaction.fromHex(broadcastedTxHexes[1])
            const outputAddr = bitcoin.address.fromOutputScript(stressTx.outs[0].script, network)
            assert.strictEqual(outputAddr, MAIN_ADDRESS)
        })

        it('fillMempool(1) distribution tx output goes to correct child address', async function () {
            await miner.fillMempool(1)
            const distTx = bitcoin.Transaction.fromHex(broadcastedTxHexes[0])
            const outputAddr = bitcoin.address.fromOutputScript(distTx.outs[0].script, network)
            const expectedChildAddr = deriveChildAddress(0)
            assert.strictEqual(outputAddr, expectedChildAddr)
        })

        it('fillMempool(1) mines 2 blocks during the process', async function () {
            await miner.fillMempool(1)
            assert.strictEqual(connectorStub.generateToAddress.callCount, 2,
                'Should mine once after funding, once after distribution')
        })

        it('fillMempool(3) broadcasts correct number of transactions', async function () {
            // Need funding tx for 3 addresses
            const fundingAmount = chunkFundingAmount(3, 0)
            const funding = createFundingTx(MAIN_ADDRESS, fundingAmount)
            connectorStub.sendToAddress.resolves(funding.txid)
            connectorStub.getRawTransaction.callsFake(async (txid) => {
                if (txid === funding.txid) return funding.hex
                return null
            })

            await miner.fillMempool(3)

            // 1 distribution tx + 3 stress txs = 4 total
            assert.strictEqual(connectorStub.sendRawTransaction.callCount, 4)
        })

        it('fillMempool(3) distribution tx has 3 outputs', async function () {
            const fundingAmount = chunkFundingAmount(3, 0)
            const funding = createFundingTx(MAIN_ADDRESS, fundingAmount)
            connectorStub.sendToAddress.resolves(funding.txid)
            connectorStub.getRawTransaction.callsFake(async (txid) => {
                if (txid === funding.txid) return funding.hex
                return null
            })

            await miner.fillMempool(3)

            const distTx = bitcoin.Transaction.fromHex(broadcastedTxHexes[0])
            assert.strictEqual(distTx.outs.length, 3, 'Distribution tx should have 3 outputs')
        })

        it('all broadcast transactions are valid parseable hex', async function () {
            const fundingAmount = chunkFundingAmount(3, 0)
            const funding = createFundingTx(MAIN_ADDRESS, fundingAmount)
            connectorStub.sendToAddress.resolves(funding.txid)
            connectorStub.getRawTransaction.callsFake(async (txid) => {
                if (txid === funding.txid) return funding.hex
                return null
            })

            await miner.fillMempool(3)

            for (let i = 0; i < broadcastedTxHexes.length; i++) {
                assert.doesNotThrow(
                    () => bitcoin.Transaction.fromHex(broadcastedTxHexes[i]),
                    `Transaction ${i} should be valid parseable hex`
                )
            }
        })
    })
})
