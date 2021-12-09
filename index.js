require('dotenv').config()
const Web3 = require('web3')
const web3  = new Web3('https://mainnet.infura.io/v3/')

const WebSocket = require('ws');
const ws = new WebSocket('wss://mainnet.infura.io/ws/v3/');

const fs = require('fs');
const axios = require('axios')

const { ethers, providers, Wallet } = require("ethers");
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");

const provider = new providers.JsonRpcProvider({ url: 'https://mainnet.infura.io/v3/' }, 1)
const authSigner = Wallet.createRandom();

const ABI = require("./ABI.json")
const ETHEREUM_ADDRESS = process.env.ETHEREUM_ADDRESS
const ETHEREUM_PRIVATE_KEY = process.env.ETHEREUM_PRIVATE_KEY
const ETHEREUM_CONTRACT_ADDRESS = '0xde2942B52e75c327AD4ddD6C7Db7c398fED6199F'
const ETHEREUM_GAS_LIMIT = 500000

let instance = new web3.eth.Contract(ABI, '0xde2942B52e75c327AD4ddD6C7Db7c398fED6199F')

// search()
tracker()

//bruteforce collection details to get rare IDs
async function search(){
  let i = 1591;
  while(i < 5000){
    console.log(`Checking ${i}`)
    let response = await axios.get(`https://ipfs.io/ipfs/Qmc7jYUZHAocgEimKHHM78aHcdfzm5MfoMk5noS5JF22uP/${i}.json`)
    if (response.data.attributes[6] && response.data.attributes[6].value == 'golden_spoon'){
      console.log(`FOUND ${i}`)
      console.log(response.data)
      fs.appendFile('./list.txt', i + '\n', function (err) {
        if (err) throw err;
        console.log('Saved!');
      });
    }
    i++
  }
}

//on every block, check how far from rares are we, and if we are close, mint!
async function tracker(){
  let wantedIds = await getWantedIds()
  wantedIds = wantedIds.sort(function(a, b) {
    return a - b;
  });

  ws.on('open', function open() {
    console.log(`Connected to WSS node...`)
    ws.send(JSON.stringify({"id": 1, "method": "eth_subscribe", "params": ["newHeads"]}))
    console.log(`Listening for new blocks...`)
  });

  ws.on('message', async function incoming(message) {
    if (JSON.parse(message).method){
      let latestMint = await instance.methods.totalSupply().call()

      for (i in wantedIds){
        if (latestMint < wantedIds[i]) {
          console.log(`Block: ${parseInt(JSON.parse(message).params.result.number, 16)}, latest minted: ${latestMint}, closest new mint: ${wantedIds[i]}`)
          if (wantedIds[i] - latestMint < 5){
            console.log(`MINTING ${wantedIds[i] - latestMint} NFTs`)
            mint(wantedIds[i] - latestMint)
          }
          break;
        }
      }
    }
  })
}

//mint tokens using flashbots
async function mint(amount){
  let nonce = await web3.eth.getTransactionCount(ETHEREUM_ADDRESS, 'pending');
  let contractFunction = instance.methods['mint'](amount).encodeABI(); //either mint() or transfer() tokens

  const wallet = new Wallet(ETHEREUM_PRIVATE_KEY)
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider, // a normal ethers.js provider, to perform gas estimiations and nonce lookups
    authSigner // ethers.js signer wallet, only for signing request payloads, not transactions
  )
  const targetBlockNumber = (await provider.getBlockNumber()) + 1
  const block = await provider.getBlock(targetBlockNumber - 1)
  const maxBaseFeeInFutureBlock = FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(block.baseFeePerGas, 2)
  let gasPrice = await getGasPrice()

  const eip1559Transaction = {
      to: ETHEREUM_CONTRACT_ADDRESS,
      type: 2,
      maxFeePerGas: ethers.BigNumber.from(gasPrice).add(maxBaseFeeInFutureBlock),
      maxPriorityFeePerGas: gasPrice,
      gasLimit: ETHEREUM_GAS_LIMIT,
      data: contractFunction,
      nonce: nonce,
      value: web3.utils.toWei((amount * 0.08).toString()),
      chainId: 1
  }
  const transactionBundle = [
    {
      signer: wallet, // ethers signer
      transaction: eip1559Transaction // ethers populated transaction object
    }
  ]

  // const signedTransactions = await flashbotsProvider.signBundle(transactionBundle)
  // const simulation = await flashbotsProvider.simulate(signedTransactions, targetBlockNumber)
  // console.log(JSON.stringify(simulation, null, 2))

  const flashbotsTransactionResponse = await flashbotsProvider.sendBundle(
    transactionBundle,
    targetBlockNumber,
  )
  console.log(flashbotsTransactionResponse)
  console.log(await flashbotsTransactionResponse.receipts())
  console.log(await flashbotsTransactionResponse.simulate())
}

async function getWantedIds(){
  let file = fs.readFileSync('./list.txt', 'utf8')
  let array = file.split('\n')
  for (i in array) array[i] = array[i].replace('\r', '')
  return array
}

async function getGasPrice(){
  let data = await axios.get('https://ethgasstation.info/api/ethgasAPI.json')
  let gasPrice = (data.data.fast / 10) + 50
  return gasPrice.toString();
}
