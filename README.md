# Max Hauri maxSMART 2.0 Adapter

Integrates the Max Hauri maxSMART 2.0 clip-clap Switch WiFi with the Mozilla IoT gateway.

May also support other devices made by Revogi.

## Pairing

The adapter can do the initial WiFi set up for your maxSMART 2.0 plug. Note that this will leak your WiFi credentials to anyone that can see your WiFi. I recommend disabling the WiFi pairing feature when there are no new plugs to pair in the add-on configuration.

I also recommend to use the adapter to pair and not the official app, since that will upload your WiFi credentials to a server.

## Security
- Separate WiFi
- Block all TCP traffic, only allow local UDP.

## Future potential

Currently the attempt to move the plug to a local address instead of its default cloud API doesn't seem successful, thus the security recommendation. Maybe the message the adapter is sending is just malformed (fingers crossed).

The plug's firmware can be upgraded via a local command, as far as I can tell. It would be nice to upgrade the plug to a custom firmware that doesn't try to communicate with the outside world at all.
