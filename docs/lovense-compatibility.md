# Lovense compatibility

The reader has 33 selectable simulation profiles. The list includes grouped generations where the same reader controls apply. A simulator shows the selected profile’s movements with a representative silhouette. Live use depends on what Lovense Remote reports, the connection method, and the device’s actual behavior.

| Model or family | Movement available through Standard JS or Standard Socket | Additional movement through Standard Socket |
| --- | --- | --- |
| Ambi, Calor, Diamo, Domi / Domi 2, Dolce, Edge / Edge 2, Exomoon, Ferri, Gemini, Glint, Gush, Hush / Hush 2, Hyphy, Lapis, Lush 1–4, Lush Anal, Lush Mini, Max / Max 2, Mission / Mission 2, Osci / Osci 2 | Vibration | — |
| Flexer | Vibration and flexing | — |
| Nora / Nora 2 | Vibration and rotation | — |
| Gravity | Vibration and thrusting | — |
| Lovense Sex Machine | Thrusting | — |
| Osci 3 | Vibration | Oscillation |
| Gush 2 / Gush 2 Motion | Vibration | Oscillation when Remote reports it |
| Ridge, Velvo | Vibration | Rotation when Remote reports it |
| Spinel, Vulse | Vibration | Thrusting when Remote reports it |
| Lovense Mini Sex Machine, Solace, Solace Pro | — | Thrusting when Remote reports it |

Remote can narrow the movements in any row. A device may be absent from the discovered list if Remote only reports movements SatinLore cannot use. The extended socket route can combine supported movements on one selected device. It sends targeted two-second commands and uses the existing per-movement calibration and Stop checks.

## Remaining compatibility work

- Fizz, Tenera and Tenera 2 use suction or tapping. Their primary motions require a separate reader control and physical qualification.
- Pumping on Max / Max 2, Solace depth and stroke positioning, heating, motion sensing, and separately addressed motors are outside the supported reader movements.
- Valor appears in Lovense’s native developer matrix. The public Lovense Remote guide does not list it, and a corresponding Remote profile remains unverified.
- Test model, generation, firmware, Remote version and browser on real hardware. A software test verifies selection, movement checks, command limits and targeted Stop requests. Physical testing verifies what actually moves and stops.

## Source contracts

- Lovense Remote discovery and the server relay. [Standard Socket API](https://developer.lovense.com/docs/standard-solutions/socket-api)
- Reported function names, Function actions, ranges and targeted commands. [Standard API](https://developer.lovense.com/docs/standard-solutions/standard-api)
- Browser SDK movement keys and model restrictions. [Standard JS SDK](https://developer.lovense.com/docs/standard-solutions/standard-js-sdk)
- Model support matrices, used to corroborate available movements before enabling the corresponding web action. [Lovense iOS SDK](https://developer.lovense.com/docs/native-sdks/ios-native-sdk) · [Lovense Android SDK](https://developer.lovense.com/docs/native-sdks/android-native-sdk)
- Retail names, model variants and product-specific movement descriptions. [Lovense user guides](https://www.lovense.com/guide/)
