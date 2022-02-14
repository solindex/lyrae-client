/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { expect } from 'chai';
import LyraeGroup from '../src/LyraeGroup';
import LyraeAccount from '../src/LyraeAccount';
import { loadTestLyraeAccount, loadTestLyraeCache, loadTestLyraeGroup, loadTestOpenOrders } from './testdata';
import { LyraeCache } from '../src';

describe('Health', async () => {
  before(async () => {
  });

  describe('empty', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/empty"
      const lyraeGroup: LyraeGroup = loadTestLyraeGroup(`${prefix}/group.json`)
      const lyraeAccount: LyraeAccount = loadTestLyraeAccount(`${prefix}/account.json`)
      const lyraeCache: LyraeCache = loadTestLyraeCache(`${prefix}/cache.json`)

      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("0");
      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("0");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("100");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("100");
      expect(
        lyraeAccount.computeValue(lyraeGroup, lyraeCache).toString()
      ).to.equal("0");
      expect(
        lyraeAccount.getLeverage(lyraeGroup, lyraeCache).toString()
      ).to.equal("0");
      expect(lyraeAccount.isLiquidatable(lyraeGroup, lyraeCache)).to.be.false
    });
  });

  describe('1deposit', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/1deposit"
      const lyraeGroup: LyraeGroup = loadTestLyraeGroup(`${prefix}/group.json`)
      const lyraeAccount: LyraeAccount = loadTestLyraeAccount(`${prefix}/account.json`)
      const lyraeCache: LyraeCache = loadTestLyraeCache(`${prefix}/cache.json`)

      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("37904260000.05905822642118252475");
      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("42642292500.06652466908819931746");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("100");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("100");
      expect(
        lyraeAccount.computeValue(lyraeGroup, lyraeCache).toString()
      ).to.equal("47380.32499999999999928946");
      expect(
        lyraeAccount.getLeverage(lyraeGroup, lyraeCache).toString()
      ).to.equal("0");
      expect(lyraeAccount.isLiquidatable(lyraeGroup, lyraeCache)).to.be.false
    });
  });

  describe('account1', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account1"
      const lyraeGroup: LyraeGroup = loadTestLyraeGroup(`${prefix}/group.json`)
      const lyraeAccount: LyraeAccount = loadTestLyraeAccount(`${prefix}/account.json`)
      lyraeAccount.spotOpenOrdersAccounts[3] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      lyraeAccount.spotOpenOrdersAccounts[6] = loadTestOpenOrders(`${prefix}/openorders6.json`)
      lyraeAccount.spotOpenOrdersAccounts[7] = loadTestOpenOrders(`${prefix}/openorders7.json`)
      const lyraeCache: LyraeCache = loadTestLyraeCache(`${prefix}/cache.json`)

      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("454884281.15520619643754685058");
      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("901472688.63722587052636470162");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("10.48860467608925262084");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("20.785925232226531989");
      expect(
        lyraeAccount.computeValue(lyraeGroup, lyraeCache).toString()
      ).to.equal("1348.25066158888197520582");
      expect(
        lyraeAccount.getLeverage(lyraeGroup, lyraeCache).toString()
      ).to.equal("3.21671490144456129201");
      expect(lyraeAccount.isLiquidatable(lyraeGroup, lyraeCache)).to.be.false
    });
  });

  describe('account2', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account2"
      const lyraeGroup: LyraeGroup = loadTestLyraeGroup(`${prefix}/group.json`)
      const lyraeAccount: LyraeAccount = loadTestLyraeAccount(`${prefix}/account.json`)
      lyraeAccount.spotOpenOrdersAccounts[2] = loadTestOpenOrders(`${prefix}/openorders2.json`)
      lyraeAccount.spotOpenOrdersAccounts[3] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      const lyraeCache: LyraeCache = loadTestLyraeCache(`${prefix}/cache.json`)

      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("7516159604.84918334545095675026");
      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("9618709877.45119083596852505025");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("24.80680004365716229131");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("31.74618756817508824497");
      expect(
        lyraeAccount.computeValue(lyraeGroup, lyraeCache).toString()
      ).to.equal("11721.35669142618275273549");
      expect(
        lyraeAccount.getLeverage(lyraeGroup, lyraeCache).toString()
      ).to.equal("3.56338611204225585993");
      expect(lyraeAccount.isLiquidatable(lyraeGroup, lyraeCache)).to.be.false
    });
  });

  describe('account3', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account3"
      const lyraeGroup: LyraeGroup = loadTestLyraeGroup(`${prefix}/group.json`)
      const lyraeAccount: LyraeAccount = loadTestLyraeAccount(`${prefix}/account.json`)
      const lyraeCache: LyraeCache = loadTestLyraeCache(`${prefix}/cache.json`)

      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("341025333625.51856223547208912805");
      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("683477170424.20340250929429970483");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("4.52652018845647319267");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("9.50397353076404272088");
      expect(
        lyraeAccount.computeValue(lyraeGroup, lyraeCache).toString()
      ).to.equal("1025929.00722205438034961844");
      expect(
        lyraeAccount.getLeverage(lyraeGroup, lyraeCache).toString()
      ).to.equal("6.50157472788435697453");
      expect(lyraeAccount.isLiquidatable(lyraeGroup, lyraeCache)).to.be.false
    });
  });

  describe('account4', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account4"
      const lyraeGroup: LyraeGroup = loadTestLyraeGroup(`${prefix}/group.json`)
      const lyraeAccount: LyraeAccount = loadTestLyraeAccount(`${prefix}/account.json`)
      const lyraeCache: LyraeCache = loadTestLyraeCache(`${prefix}/cache.json`)

      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("-848086876487.04950427436299875694");
      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("-433869053006.07361789143756070075");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("-9.30655353087566084014");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("-4.98781798472691662028");
      expect(
        lyraeAccount.computeValue(lyraeGroup, lyraeCache).toString()
      ).to.equal("-19651.22952604663374742699");
      expect(
        lyraeAccount.getLeverage(lyraeGroup, lyraeCache).toString()
      ).to.equal("-421.56937094643044972031");
      expect(lyraeAccount.isLiquidatable(lyraeGroup, lyraeCache)).to.be.true
    });
  });

  describe('account5', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account5"
      const lyraeGroup: LyraeGroup = loadTestLyraeGroup(`${prefix}/group.json`)
      const lyraeAccount: LyraeAccount = loadTestLyraeAccount(`${prefix}/account.json`)
      lyraeAccount.spotOpenOrdersAccounts[0] = loadTestOpenOrders(`${prefix}/openorders0.json`)
      lyraeAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders1.json`)
      lyraeAccount.spotOpenOrdersAccounts[2] = loadTestOpenOrders(`${prefix}/openorders2.json`)
      lyraeAccount.spotOpenOrdersAccounts[3] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      lyraeAccount.spotOpenOrdersAccounts[8] = loadTestOpenOrders(`${prefix}/openorders8.json`)
      const lyraeCache: LyraeCache = loadTestLyraeCache(`${prefix}/cache.json`)

      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("15144959918141.09175135195858530324");
      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("15361719060997.68276021614036608298");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("878.88913077823325181726");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("946.44498820888003365326");
      expect(
        lyraeAccount.computeValue(lyraeGroup, lyraeCache).toString()
      ).to.equal("15578478.17337437202354522015");
      expect(
        lyraeAccount.getLeverage(lyraeGroup, lyraeCache).toString()
      ).to.equal("0.09884076560217636143");
      expect(lyraeAccount.isLiquidatable(lyraeGroup, lyraeCache)).to.be.false
    });
  });

  describe('account6', async () => {
    it('Health calculations should return the correct results', async () => {
      const prefix = "./testdata/account6"
      const lyraeGroup: LyraeGroup = loadTestLyraeGroup(`${prefix}/group.json`)
      const lyraeAccount: LyraeAccount = loadTestLyraeAccount(`${prefix}/account.json`)
      lyraeAccount.spotOpenOrdersAccounts[0] = loadTestOpenOrders(`${prefix}/openorders0.json`)
      lyraeAccount.spotOpenOrdersAccounts[1] = loadTestOpenOrders(`${prefix}/openorders1.json`)
      lyraeAccount.spotOpenOrdersAccounts[2] = loadTestOpenOrders(`${prefix}/openorders2.json`)
      lyraeAccount.spotOpenOrdersAccounts[3] = loadTestOpenOrders(`${prefix}/openorders3.json`)
      lyraeAccount.spotOpenOrdersAccounts[8] = loadTestOpenOrders(`${prefix}/openorders8.json`)
      const lyraeCache: LyraeCache = loadTestLyraeCache(`${prefix}/cache.json`)

      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("14480970069238.33686487450164648294");
      expect(
        lyraeAccount.getHealth(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("15030566251990.17026082618337312624");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Init').toString()
      ).to.equal("215.03167137712999590349");
      expect(
        lyraeAccount.getHealthRatio(lyraeGroup, lyraeCache, 'Maint').toString()
      ).to.equal("236.77769605824430243501");
      expect(
        lyraeAccount.computeValue(lyraeGroup, lyraeCache).toString()
      ).to.equal("15580162.40781940827396567784");
      expect(
        lyraeAccount.getLeverage(lyraeGroup, lyraeCache).toString()
      ).to.equal("0.07913870989902704878");
      expect(lyraeAccount.isLiquidatable(lyraeGroup, lyraeCache)).to.be.false
    });
  });
});
