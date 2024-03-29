// Copyright (c) 2019 Martin Giger
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

const {Adapter, Device, Property, Database} = require('gateway-addon');
const maxsmart = require("mh-maxsmart2");
const easylink = require("mh-maxsmart2/easylink");
const manifest = require("./manifest.json");

class ReadonlyProperty extends Property {
    constructor(device, name, description) {
        description.readOnly = true;
        super(device, name, description);
    }

    async setValue(value) {
        return Promise.reject("Read-only property");
    }

    setReadonly(value) {
        if(value !== this.value) {
            this.setCachedValueAndNotify(value);
            if(this.value != this.prevSetValue) {
                this.prevSetValue = this.value;
            }
        }
    }
}


class Plug extends Device {
    constructor(adapter, desc) {
        super(adapter, desc.sn);
        this.setTitle(desc.name || desc.sn);
        this.udpDevice = desc;
        this.description = "Max Hauri maxSMART 2.0 clip-clap Switch WiFi";
        this.lastSuccesfulRequest = 0;
        this['@type'] = [ 'SmartPlug', 'EnergyMonitor', 'OnOffSwitch' ];

        this.properties.set('on', new Property(this, 'on', {
            type: 'boolean',
            '@type': 'OnOffProperty',
            label: 'On'
        }));
        this.properties.set('watt', new ReadonlyProperty(this, 'watt', {
            type: 'number',
            '@type': 'InstantaneousPowerProperty',
            unit: 'watt',
            label: 'Power',
            minimum: 0,
            maximum: 2400
        }));
        this.properties.set('amp', new ReadonlyProperty(this, 'amp', {
            type: 'number',
            '@type': 'CurrentProperty',
            unit: 'ampere',
            label: 'Current',
            minimum: 0,
            maximum: 10
        }));

        this.update();
    }

    async udpSend(command, data = {}) {
        const thisTime = Date.now();
        try {
            const res = await maxsmart.send(this.udpDevice.sn, this.udpDevice.ip, command, data, 10000);
            this.lastSuccesfulRequest = thisTime;
            return res;
        }
        catch (e) {
            if(this.lastSuccesfulRequest <= thisTime) {
                this.handleRequestError(e);
            }
            else {
                console.error(e);
            }
        }
    }

    handleRequestError(e) {
        if(e.code === 0) {
            this.connectedNotify(false);
        }
        else {
            console.error(e);
        }
    }

    async update() {
        const res = await this.udpSend(maxsmart.CMD.GET_WATT);
        this.connectedNotify(true);
        if(!res) {
            return;
        }
        this.findProperty('watt').setReadonly(res.watt);
        this.findProperty('amp').setReadonly(res.amp);
        if(res.watt > 0) {
            this.findProperty('on').setCachedValueAndNotify(true);
        }
    }

    async notifyPropertyChanged(property) {
        if(property.name === 'on') {
            await this.udpSend(maxsmart.CMD.CONTROL, maxsmart.makeControlPacket(property.value));
        }
        super.notifyPropertyChanged(property);
    }
}

class MaxSmartAdapter extends Adapter {
    constructor(addonManager, config) {
        super(addonManager, manifest.id, manifest.id);
        addonManager.addAdapter(this);
        this.config = config;
        config.devices = config.devices || [];

        for(const device of config.devices) {
            this.addDevice(device);
        }
    }

    addDevice(desc) {
        if(desc.sn in this.devices) {
            this.devices[desc.sn].connectedNotify(true);
            this.devices[desc.sn].udpDevice = desc;
            return;
        }
        const device = new Plug(this, desc);
        if(!this.interval) {
            this.interval = setInterval(() => this.updateDevices(), 10000);
        }
        this.handleDeviceAdded(device);
    }

    handleDeviceRemoved(device) {
        super.handleDeviceRemoved(device);
        if(this.interval && !Object.keys(this.devices).length) {
            clearInterval(this.interval);
            delete this.interval;
        }
    }

    unload() {
        if(this.interval) {
            clearInterval(this.interval);
            delete this.interval;
        }
        return super.unload();
    }

    updateDevices() {
        for(const device of Object.values(this.devices)) {
            device.update();
        }
    }

    async addDeviceToDB(deviceInfo) {
        const db = new Database(this.packageName);
        await db.open();
        this.config.devices.push({
            sn: deviceInfo.sn,
            ip: deviceInfo.ip
        });
        await db.saveConfig({
            devices: this.config.devices,
            pairing: this.config.pairing,
            wifiInfo: this.config.wifiInfo
        });
    }

    async startPairing(timeout = 10000) {
        if(this.config.pairing && this.config.wifiInfo && this.config.wifiInfo.ssid && this.config.wifiInfo.password) {
            await easylink.sendWifiInfo(this.config.wifiInfo.ssid, this.config.wifiInfo.password);
            maxsmart.discoverDevices(async (deviceInfo) => {
                if(maxsmart.isMaxSmart2Plug(deviceInfo)) {
                    if(!this.devices.hasOwnProperty(deviceInfo.sn)) {
                        if(!deviceInfo.regId) {
                            const bindPacket = maxsmart.makeBindServerPacket('MHM000000000', 'localhost', 5000);
                            await maxsmart.send(deviceInfo.sn, deviceInfo.ip, maxsmart.CMD.BIND, bindPacket);
                        }
                        await this.addDeviceToDB(deviceInfo);
                    }
                    this.addDevice(deviceInfo);
                    this.sendPairingPrompt('If all maxSMART plugs are now listed, disable WiFi pairing in the adapter settings');
                }
            });
        }
        else {
            maxsmart.discoverDevices(async (deviceInfo) => {
                if(maxsmart.isMaxSmart2Plug(deviceInfo)) {
                    if(!this.devices.hasOwnProperty(deviceInfo.sn)) {
                        await this.addDeviceToDB(deviceInfo);
                    }
                    this.addDevice(deviceInfo);
                }
            }, timeout);
        }
    }

    async removeDeviceFromDB(device) {
        const db = new Database(this.packageName);
        await db.open();
        this.config.devices.splice(this.config.devices.findIndex((d) => d.sn === device.sn), 1);
        await db.saveConfig({
            devices: this.config.devices,
            pairing: this.config.pairing,
            wifiInfo: this.config.wifiInfo
        });
    }

    async removeThing(device) {
        await this.removeDeviceFromDB(device);
        return super.removeThing(device);
    }
}

module.exports = async (addonManager, reportError) => {
    const db = new Database(manifest.id);
    await db.open();
    const config = await db.loadConfig();
    if(config.pairing && !(config.wifiInfo.ssid && config.wifiInfo.password)) {
        reportError("Pairing is enabled but no WiFi network is configured");
    }
    else {
        new MaxSmartAdapter(addonManager, config);
    }
};
