// Copyright (c) 2019 Martin Giger
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

const {Adapter, Device, Property} = require('gateway-addon');
const maxsmart = require("mh-maxsmart2");

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
            this.setCachedValue(value);
            this.device.notifyPropertyChanged(this);
            if(this.value != this.prevSetValue) {
                this.prevSetValue = this.value;
            }
        }
    }
}


class Plug extends Device {
    constructor(adapter, desc) {
        super(adapter, desc.sn);
        this.name = desc.sn;
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
            if(this.destroyed) {
                throw new Error("Device already gone");
            }
            this.adapter.removeThing(this);
            this.destroyed = true;
            setTimeout(() => {
                this.udpSend(maxsmart.CMD.GET_WATT).then(() => {
                    this.destroyed = false;
                    this.adapter.addDevice(this.udpDevice);
                }).catch(() => {
                    console.error("Lost connection to", this.sn);
                });
            }, 60000);
            throw e;
        }
        else {
            console.error(e);
        }
    }

    async update() {
        const res = await this.udpSend(maxsmart.CMD.GET_WATT);
        this.findProperty('watt').setReadonly(res.watt);
        this.findProperty('amp').setReadonly(res.amp);
    }

    async notifyPropertyChanged(property) {
        if(property.name === 'on') {
            await this.udpSend(maxsmart.CMD.CONTROL, maxsmart.makeControlPacket(property.value));
        }
        super.notifyPropertyChanged(property);
    }
}

class MaxSmartAdapter extends Adapter {
    constructor(addonManager, name, config) {
        super(addonManager, 'MaxSmart2Adapter', name);
        addonManager.addAdapter(this);

        for(const device of config.devices) {
            this.addDevice(device);
        }
    }

    addDevice(desc) {
        if(desc.sn in this.devices) {
            console.warn("Device already exists", desc.sn);
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
}

module.exports = (addonManager, manifest, reportError) => {
    new MaxSmartAdapter(addonManager, manifest.name, manifest.moziot.config);
};
