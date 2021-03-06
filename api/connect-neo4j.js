
import { v1 as neo4j } from 'neo4j-driver';

import utils from 'utility';
import uuid from 'node-uuid';
import config from '../config';
import fs from 'fs';
import path from 'path';


/*
███    ██ ███████  ██████  ██   ██      ██
████   ██ ██      ██    ██ ██   ██      ██
██ ██  ██ █████   ██    ██ ███████      ██
██  ██ ██ ██      ██    ██      ██ ██   ██
██   ████ ███████  ██████       ██  █████
*/




export const NO_RESULT = Symbol.for('NO_RESULT'); // 用于表示某些查找没有返回结果，这比 null 好

function useNeo4jDB(url, userName, passWord) {
  // Create a driver instance, for the user neo4j with password neo4j.
  const driver = neo4j.driver(`bolt://${url}`, neo4j.auth.basic(userName, passWord), { encrypted: true, trust: 'TRUST_ON_FIRST_USE'});

  // Create a session to run Cypher statements in.
  // Note: Always make sure to close sessions when you are done using them!
  const session = driver.session();

  let _session = session;
  let _lastTransaction = session;


  return (cypherQuery, transaction = undefined) => {
    if (transaction !== undefined) { // 只有 transaction 开关被显式指定了，才进入此分支
      _session = transaction ? session.beginTransaction() : session; // 如果打开事务性开关，就把接下来的所有命令
      // 都放在 session.beginTransaction() 里执行
      if (transaction === true) {
        _lastTransaction = _session; // 每次 transaction 开始后就保存一个 session.beginTransaction() 的副本，以便 commit
      }
    }
    return new Promise((resolve, reject) => {
      if (cypherQuery.query.length === 0 && transaction !== undefined) {
        // cypherQuery 中的请求为空字符串的情况视作只是想修改 transaction 模式
        resolve(_lastTransaction); // 见下方事务性调用的例子
      }

      _session.run(cypherQuery.query, cypherQuery.params)
      .then(result => {
        if (result.records.length === 0 || !result.records[0]) {
          resolve(NO_RESULT); // 没啥结果的时候
        } else {
          resolve(result.records); // 还是有点结果的时候
        }
      })
      .catch(err => reject(err));
    });
  };
}



const run = useNeo4jDB(config.neo4jHost.split('//')[1] + ':' + config.neo4jBoltPort, config.neo4jUserName, config.neo4jPassword);




export function cleanNodeAndRelationships() {
  return run({
    query: 'MATCH (n) OPTIONAL MATCH (n)-[r]-() DELETE n,r'
  });
}


/*
 █████  ██████  ██████
██   ██ ██   ██ ██   ██
███████ ██   ██ ██   ██
██   ██ ██   ██ ██   ██
██   ██ ██████  ██████
*/


export function initMetaData(ordinaryCookTime = 5, shopOpen = false, newUUID = uuid.v4()) {
  return run({
    query: 'MERGE (c:COOK :USER) ON CREATE SET c.uuid={uuid}, c.shopOpen=FALSE RETURN c.uuid AS id',
    params: {
      uuid: newUUID,
    },
  })
}


// 添加米饭之类的主食
export function addMainPrinciple(principleChineseName, newUUID = uuid.v4()) {
  return run({
    query: 'MERGE (n:PRINCIPLE :MAIN_PRINCIPLE {chineseName: {chineseName}}) ON CREATE SET n.uuid={uuid}, n.usedUp=FALSE RETURN n.uuid AS id',
    params: {
      chineseName: principleChineseName,
      uuid: newUUID,
    },
  })
  .then(results => {
    if (results === NO_RESULT) {
      return Promise.reject('Error: No_UUID_RETURN in addMainPrinciple, maybe MERGE operation failed');
    }
    const addedUUID = results[0].get('id');
    const newMainPrinciple = {
      id: addedUUID,
      principle: principleChineseName,
    };
    return newMainPrinciple;
  });
}



// 添加肉丝之类的配菜
export function addVicePrinciple(principleChineseName, newUUID = uuid.v4()) {
  return run({
    query: 'MERGE (n:PRINCIPLE :VICE_PRINCIPLE {chineseName: {chineseName}}) ON CREATE SET n.uuid={uuid}, n.usedUp=FALSE RETURN n.uuid AS id',
    params: {
      chineseName: principleChineseName,
      uuid: newUUID,
    },
  })
  .then(results => {
    if (results === NO_RESULT) {
      return Promise.reject('Error: No_UUID_RETURN in addVicePrinciple, maybe MERGE operation failed');
    }
    const addedUUID = results[0].get('id');
    const newMainPrinciple = {
      id: addedUUID,
      principle: principleChineseName,
    };
    return newMainPrinciple;
  });
}



// 用户可能第二天还是用同一个名字登陆，所以第一次用这个名字和第二次用要有不一样的数据库操作
export function addUser(userName, newUUID = uuid.v4()) {
  return run({
    query: 'MERGE (u:USER {userName: {userName}}) ON CREATE SET u.uuid={uuid}, u.loginTrys=1 ON MATCH SET u.loginTrys=coalesce(u.loginTrys, 1)+1 SET u.lastLoginTime=toString(timestamp()) RETURN u.uuid AS id',
    params: {
      userName,
      uuid: newUUID,
    },
  })
  .then(results => {
    if (results === NO_RESULT) {
      return Promise.reject('Error: No_UUID_RETURN in addUser, maybe MERGE operation failed');
    }
    const addedUUID = results[0].get('id');
    const newUser = {
      id: addedUUID,
      userName
    };
    return newUser;
  });
}


const getActiveOrderByUser = (userUUID, newUUID) => run({
  query: 'MATCH (u:USER {uuid: {userUUID}}) OPTIONAL MATCH (ao:ORDER) WHERE ao.finished=FALSE AND ao.canceled=FALSE MERGE (o:ORDER {uuid: {newUUID}, finished: FALSE, paid: FALSE, canceled: FALSE})-[r:ORDERED_BY]->(u) WITH o, count(ao) AS activeOrders SET o.startTime=toString(timestamp()), o.startedQueuePos=activeOrders+1 RETURN o.uuid AS id',
  params: {
    userUUID,
    newUUID
  }
});

// 用食材的 uuid 列表和用户的 uuid 添加一个订单， 先检查有没有 ActiveOrder 在排队。 如果 results === NO_RESULT 就说明是老板下的单，得先给他创建一个 USER 账户
export function addOrder(principleUUIDList, userUUID, newUUID = uuid.v4()) {
  return getActiveOrderByUser(userUUID, newUUID)
  .then(results => results === NO_RESULT ? initMetaData().then(results => getActiveOrderByUser(results[0].get('id'), newUUID)).then(results => results[0].get('id')) : results[0].get('id'))
  .then(orderUUID => {

    let promiseArray = [];
    for(let principleUUID of principleUUIDList) {
      promiseArray.push(
        run({
          query: 'MATCH (o:ORDER {uuid: {orderUUID}}), (p:PRINCIPLE {uuid: {principleUUID}}) CREATE (o)-[r:USE]->(p) RETURN p.uuid AS id',
          params: {
            orderUUID,
            principleUUID
          }
        })
      );
    }
    return Promise.all( promiseArray )
      .then(results => results.map(result => result[0].get('id')));
  });
}


/*
███████ ███████ ████████
██      ██         ██
███████ █████      ██
     ██ ██         ██
███████ ███████    ██
*/


export function setPriceOfPrinciple(principleUUID, price) {
  return run({
    query: 'MATCH (p:PRINCIPLE {uuid: {principleUUID}}) SET p.price={price} RETURN p.uuid AS id',
    params: {
      principleUUID,
      price
    }
  })
  .then(results => results[0].get('id'));
}



export function updateOrderPrice(orderUUID) {
  return run({
    query: 'MATCH (o:ORDER {uuid: {orderUUID}}) SET o.price=0 WITH o MATCH (o)-->(p:PRINCIPLE) WITH o, p SET o.price=o.price+p.price RETURN o.price AS price',
    params: {
      orderUUID
    }
  })
  .then(results => results.pop().get('price')); // 返回的是累加的过程，所以要取列表的最后一位，也就是计算的结果
}


export function cancelOrder(orderUUID) {
  return run({
    query: 'MATCH (o:ORDER {uuid: {orderUUID}}) SET o.canceled=TRUE, o.finished=TRUE RETURN o.uuid AS id',
    params: {
      orderUUID
    }
  })
  .then(results => results === NO_RESULT ? Promise.reject('Error: NO_RESULT in cancelOrder') : results[0].get('id'));
}




export function finishOrder(orderUUID) {
  return run({
    query: 'MATCH (o:ORDER {uuid: {orderUUID}}) SET o.finished=TRUE RETURN o.uuid AS id',
    params: {
      orderUUID
    }
  })
  .then(results => results === NO_RESULT ? Promise.reject('Error: NO_RESULT in cancelOrder') : results[0].get('id'));
}


export function paidOrder(orderUUID) {
  return run({
    query: 'MATCH (o:ORDER {uuid: {orderUUID}}) SET o.paid=TRUE, o.finished=TRUE RETURN o.uuid AS id',
    params: {
      orderUUID
    }
  })
  .then(results => results === NO_RESULT ? Promise.reject('Error: NO_RESULT in paidOrder') : results[0].get('id'));
}


// 用于增加备注
export function setOrderTip(orderUUID, tip) {
  return run({
    query: 'MATCH (o:ORDER {uuid: {orderUUID}}) SET o.tip={tip} RETURN o.uuid AS id',
    params: {
      orderUUID,
      tip
    }
  })
  .then(results => results === NO_RESULT ? Promise.reject('Error: NO_RESULT in setOrderTip') : results[0].get('id'));
}


export function usedUpPrinciple(principleUUID) {
  return run({
    query: 'MATCH (p:PRINCIPLE {uuid: {principleUUID}}) SET p.usedUp=TRUE RETURN p.uuid AS id',
    params: {
      principleUUID
    }
  })
  .then(results => results === NO_RESULT ? Promise.reject('Error: NO_RESULT in usedUpPrinciple') : results[0].get('id'));
}


export function rewindPrinciple(principleUUID) {
  return run({
    query: 'MATCH (p:PRINCIPLE {uuid: {principleUUID}}) SET p.usedUp=FALSE RETURN p.uuid AS id',
    params: {
      principleUUID
    }
  })
  .then(results => results === NO_RESULT ? Promise.reject('Error: NO_RESULT in rewindPrinciple') : results[0].get('id'));
}


export function rewindAllPrinciples() {
  return run({
    query: 'MATCH (p:PRINCIPLE) SET p.usedUp=FALSE RETURN p.uuid AS id'
  })
  .then(results => results === NO_RESULT ? [] : results);
}


export function usedUpAllPrinciples() {
  return run({
    query: 'MATCH (p:PRINCIPLE) SET p.usedUp=TRUE RETURN p.uuid AS id'
  })
  .then(results => results === NO_RESULT ? [] : results);
}


export function shopClose() {
  return run({
    query: 'MATCH (c:COOK) SET c.shopOpen=FALSE RETURN c.uuid AS id'
  })
}


export function shopOpen() {
  return run({
    query: 'MATCH (c:COOK) SET c.shopOpen=TRUE RETURN c.uuid AS id'
  })
  .then(rewindAllPrinciples);
}


/*
 ██████  ███████ ████████
██       ██         ██
██   ███ █████      ██
██    ██ ██         ██
 ██████  ███████    ██
*/


export function getActiveOrder() {
  return run({
    query: 'MATCH (o:ORDER {paid: FALSE, canceled: FALSE}) RETURN o.uuid AS id, o.startTime AS startTime ORDER BY startTime',
  })
  .then(results => results === NO_RESULT ? [] : results)
  .then(results => results.map((result, index) => {
    return {
      id: result.get('id'),
      ordinal: index,
      startTime: result.get('startTime')
    }
  }));
}




export function getOrderDetail(orderUUID, ordinal = 0) {
  return updateOrderPrice(orderUUID)
    .then(() => run({
      query: 'MATCH (u:USER)<--(o:ORDER {uuid: {orderUUID}}) RETURN o.price AS price, o.uuid AS orderUUID, o.startTime AS startTime, o.finished AS finished, o.canceled AS canceled, o.paid AS paid, o.tip AS tip, u.userName AS userName, u.uuid AS userUUID',
      params: {
        orderUUID
      }
    }))
    .then(results => {
      let orederData = {
        mainPrinciples: [],
        vicePrinciples: [],
        ordinal,
        price: results[0].get('price') || NaN,
        tip: results[0].get('tip') || '',
        finished: results[0].get('finished'),
        canceled: results[0].get('canceled'),
        paid: results[0].get('paid'),
        startTime: results[0].get('startTime'),
        id: results[0].get('orderUUID'),
        userName: results[0].get('userName'),
        userUUID: results[0].get('userUUID')
      };
      return orederData;
    })
    .then(orederData => run({
        query: 'MATCH (o:ORDER {uuid: {orderUUID}})-->(p:MAIN_PRINCIPLE) RETURN p.chineseName AS chineseName, p.uuid AS principleUUID',
        params: {
          orderUUID
        }
      })
      .then(results => {
        if (results !== NO_RESULT) {
          results.map(result => {
            orederData['mainPrinciples'].push({
              id: result.get('principleUUID'),
              chineseName: result.get('chineseName')
            });
          });
        }
        return orederData;
      })
    )
    .then(orederData => run({
        query: 'MATCH (o:ORDER {uuid: {orderUUID}})-->(p:VICE_PRINCIPLE) RETURN p.chineseName AS chineseName, p.uuid AS principleUUID',
        params: {
          orderUUID
        }
      })
      .then(results => {
        if (results !== NO_RESULT) {
          results.map(result => {
            orederData['vicePrinciples'].push({
              id: result.get('principleUUID'),
              chineseName: result.get('chineseName')
            });
          });
        }
        return orederData;
      })
  );
}


export function getCookMetaData() {
  return run({
    query: 'MATCH (c:COOK) RETURN c.shopOpen AS shopOpen'
  })
  .then(results => {
    let cookData = {
      shopOpen: results[0].get('shopOpen'),
    };
    return cookData;
  })

}


export async function getQueue() {
  let promises = await getActiveOrder().then(results => results.map(result => getOrderDetail(result.id, result.ordinal)));
  return await Promise.all(promises);
}

export async function getAll() {
  let queue = await getQueue();
  let principles = await getPrincipleList();
  let cookData = await getCookMetaData();
  return {queue, principles, cookData}
}



export function getPrinciple(principleUUID) {
  return run({
    query: 'MATCH (p:PRINCIPLE {uuid: {principleUUID}}) RETURN p.chineseName AS chineseName, p.price AS price, p.usedUp AS usedUp',
    params: {
      principleUUID
    }
  })
  .then(results => {
    return {
      id: principleUUID,
      chineseName: results[0].get('chineseName'),
      usedUp: results[0].get('usedUp'),
      price: results[0].get('price') || NaN
    }
  });
}




export function getPrincipleList() {
  let orederData = {mainPrinciples: [], vicePrinciples: []};

  return run({
    query: 'MATCH (p:MAIN_PRINCIPLE) RETURN p.chineseName AS chineseName, p.uuid AS principleUUID, p.price AS price, p.usedUp AS usedUp'
  })
  .then(results => {
    if (results !== NO_RESULT) {
      results.map(result => {
        orederData['mainPrinciples'].push({
          id: result.get('principleUUID'),
          chineseName: result.get('chineseName'),
          usedUp: result.get('usedUp'),
          price: result.get('price') || NaN
        });
      });
    }
  })
  .then(() => run({
    query: 'MATCH (p:VICE_PRINCIPLE) RETURN p.chineseName AS chineseName, p.uuid AS principleUUID, p.price AS price, p.usedUp AS usedUp'
  }))
  .then(results => {
    if (results !== NO_RESULT) {
      results.map(result => {
        orederData['vicePrinciples'].push({
          id: result.get('principleUUID'),
          chineseName: result.get('chineseName'),
          usedUp: result.get('usedUp'),
          price: result.get('price') || NaN
        });
      });
    }
    return orederData;
  });
}


/*
██████  ███████ ██      ███████ ████████ ███████
██   ██ ██      ██      ██         ██    ██
██   ██ █████   ██      █████      ██    █████
██   ██ ██      ██      ██         ██    ██
██████  ███████ ███████ ███████    ██    ███████
*/


export function deletePrincipleFromOrder(principleUUID, orderUUID) {
  return run({
    query: 'MATCH (o:ORDER {uuid: {orderUUID}})-[r]->(p:PRINCIPLE {uuid: {principleUUID}}) DELETE r RETURN o.uuid AS id',
    params: {
      principleUUID,
      orderUUID
    }
  })
  .then(results => results === NO_RESULT ? Promise.reject(`NO_RESULT in deletePrincipleFromOrder, maybe relationship between principleUUID: ${principleUUID} and orderUUID: ${orderUUID} don\'t really exists, or you mistake order of args`) : results[0].get('id'));
}
