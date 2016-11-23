'use strict'

const Component = require('./Component')
const helper = require('./helper')
const hours = require('./Hours')
const storage = require('./Storage')
const blockchain = require('./Blockchain')
const synchronizer = require('./Synchronizer')
const Block = require('./Block')
const BlockHelper = require('./BlockHelper')
const Tx = require('./Tx')

module.exports = new class Miner extends Component {

  constructor() {
    super()
    this.module = 'MNR'
    this.minerAddresses = null
    this.lastBlock = null
    this.lastBlockId = null
    this.lastBlockHash = null
    this.block = null
    this.blockPacked = null
    this.hashCount = 0
    this.doRestart = false
    
    setInterval(() => {
      this.update({time: hours.now()})
      this.hashCount && this.log(parseInt(this.hashCount / 10) + ' H/sec.' + (this.block ? ' diff. ' + helper.bufToHex(this.block.diff.slice(0, 16)) + '...' : ''))
      this.hashCount = 0
    }, 10000)
  }
  
  update(data) {
    if (this.block && this.blockPacked) {
      Block.set(this.blockPacked, data)
      for (let i in data) {
        this.block[i] = data[i]
      }
      this.block.nonce = 0
      this.log('Updated', data)
    }
  }
  
  restart() {
    this.doRestart = true
  }
  
  run(minerAddresses = null) {
    if (minerAddresses) {
      this.minerAddresses = minerAddresses
    }
    this.log('>>> New block mining <<<')
    var currentBlockId = blockchain.getLength()
    this.lastBlockId = currentBlockId - 1
    var lastBlock = blockchain.get(this.lastBlockId)
    this.lastBlockHash = lastBlock.hash
    this.lastBlock = Block.unpack(lastBlock.data)
    
    var txHashList = []
    var txList = []
    var feeSum = 0
    
    for (let i in storage.freeTxs) {
      let freeTx = storage.freeTxs[i]
      if (freeTx) {
        txHashList.push(helper.hexToBuf(i))
        txList.push(helper.baseToBuf(freeTx.data))
        feeSum += freeTx.fee
      }
    }
    var txOuts = [{address: helper.randomItem(this.minerAddresses), value: BlockHelper.calcReward(blockchain.getLength()) + feeSum}]
    
    var tx = {
      time: hours.now(),
      txKeys: [],
      txIns: [],
      txOutCount: txOuts.length,
      txOutsRaw: Tx.packOuts(txOuts)
    }
    var txPacked = Tx.pack(tx)
    txHashList.unshift(helper.hash(txPacked))
    txList.unshift(txPacked)
    
    this.log('There are ' + txHashList.length + ' txs in block')
    
    this.block = {
      ver: 1,
      prevBlock: this.lastBlockHash,
      time: hours.now(),
      diff: Block.calcDiff(currentBlockId, this.lastBlock.diff, Block.getByTimeCount(this.lastBlock.time - 3600, this.lastBlock.time)),
      nonce: 0,
      txList: txList,
      txHashList: txHashList
    }
    this.blockPacked = Block.pack(this.block)
    
    let hash = null
    helper.asyncWhile(() => {
      for (let i = 0; i < 1000; i++) {
        if (this.doRestart) {
          return false
        }
        this.hashCount++
        this.block.nonce++
        Block.set(this.blockPacked, {
          nonce: this.block.nonce
        })
        hash = Block.calcHash(this.blockPacked)
        if (hash) {
          return false
        }
        this.trigger('processing')
        return true
      }
    }, {
      after: () => {
        if (this.doRestart) {
          this.doRestart = false
          setTimeout(() => {
            this.run()
          }, 1)
          return
        }
        this.log('!!! BLOCK FOUND !!!')
        this.log(hash.toString('hex'))
        synchronizer.add(hash, this.blockPacked, {
          onAccept: () => {
            synchronizer.broadcast(hash, this.blockPacked)
            let deleted = 0
            for (let i in txHashList) {
              if (Tx.freeTxDelete(txHashList[i])) {
                deleted++
              }
            }
            this.log('Free txs used: ' + deleted)
          }
        })
        
        this.trigger('blockFound', this.blockPacked, hash)
        setTimeout(() => {
          this.run()
        }, 1)
      }
    })
  }
}