import PouchDB from 'pouchdb'
import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk"
import { decodeSuiPrivateKey, encodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { env } from "../utils/envConfig.js"
import { ethers } from "ethers"

// This class manages user authentication and key generation

class AccountManagement {

    constructor() {
        this.db = new PouchDB(`${env.NODE_ENV}:account`)
    }

    // Password should be hashed on the client side
    signUp = async (email, password) => {

        if (/^[\w-\.]+@([\w-]+\.)+[\w-]{2,8}$/.test(email) === false) {
            throw new Error("Invalid Email")
        }

        // Generate a key for Aptos
        const { privateKey } = Account.generate();

        // Generate a key for Sui
        const keypair = new Ed25519Keypair()

        const item = {
            _id: email,
            password,
            credits: 30,
            created: new Date().valueOf(),
            messages: [
                "An initial credit of 30 credits has been applied to your account"
            ],
            timestamps: [
                new Date().valueOf()
            ],
            keys: [
                {
                    "network": "aptos",
                    "value": `${privateKey}`
                },
                {
                    "network": "sui",
                    "value": `${keypair.getSecretKey()}`
                }
                // TODO: adding EVM
            ],
            // Default context for Move code review.
            context: {
                "default": [
                    "https://raw.githubusercontent.com/tamago-labs/x-engine/refs/heads/main/packages/context/broken-access-controls.md",
                    "https://raw.githubusercontent.com/tamago-labs/x-engine/refs/heads/main/packages/context/integer-overflow-and-underflow.md",
                    "https://raw.githubusercontent.com/tamago-labs/x-engine/refs/heads/main/packages/context/move-vector-limitations.md",
                    "https://raw.githubusercontent.com/tamago-labs/x-engine/refs/heads/main/packages/context/re-entrancy.md",
                    "https://raw.githubusercontent.com/tamago-labs/x-engine/refs/heads/main/packages/context/sui-vs-aptos-move-differences.md"
                ]
            }
        }

        await this.db.put(item)
    }

    logIn = async (email, password) => {

        try {
            let entry = await this.db.get(email)

            if (entry.password !== password) {
                throw new Error("Password mismatched")
            }

            // add daily free credits
            const yesterday = new Date(new Date().setDate(new Date().getDate() - 1));
            const yesterdayTs = yesterday.valueOf()

            const dailyCount = entry.timestamps.filter(item => item > yesterdayTs).length

            if (dailyCount === 0) {
                entry.credits = entry.credits + 10
                entry.messages.push("You’ve received your 10 free daily credits")
                entry.timestamps.push(new Date().valueOf())

                await this.db.put(entry)
            }

            let aptosAddresses = []
            let suiAddresses = []

            for (let key of entry.keys) {

                if (key.network === "aptos") {
                    const privateKey = new Ed25519PrivateKey(key.value)
                    const thisAccount = await Account.fromPrivateKey({ privateKey })
                    aptosAddresses.push(`${thisAccount.accountAddress}`)
                } else if (key.network === "sui") {
                    const keypair = Ed25519Keypair.fromSecretKey(key.value);
                    const address = keypair.getPublicKey().toSuiAddress();
                    suiAddresses.push(address)
                }

            }

            return {
                sessionId: ethers.hashMessage(`${email}${entry.created}`), // use simple hash with no expiration on this beta
                email,
                credits: entry.credits,
                created: entry.created,
                messages: entry.messages,
                aptosAddresses,
                suiAddresses,
                context: entry.context
            }
        } catch (e) {
            if (e.message === "missing") {
                throw new Error("Given email not found")
            } else {
                throw e
            }
        }

    }

    // deduct credits
    deduct = async (account, sessionId, filename, credit) => {

        try {
            let entry = await this.db.get(account)

            if (ethers.hashMessage(`${account}${entry.created}`) !== sessionId) {
                throw new Error("Invalid session ID")
            }

            if (entry.credits < credit) {
                throw new Error("Insufficient credits")
            }

            entry.credits = entry.credits - credit
            entry.messages.push(`Received submission request for ${filename}`)
            entry.timestamps.push(new Date().valueOf())

            await this.db.put(entry)

        } catch (e) {
            if (e.message === "missing") {
                throw new Error("Given email not found")
            } else {
                throw e
            }
        }

    }

    destroy = async () => {
        await this.db.destroy();
    }

}


export default AccountManagement