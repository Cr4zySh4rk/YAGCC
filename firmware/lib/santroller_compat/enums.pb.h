// The Santroller SubType values the ported libraries (psx_emulation, wii_extension_emulation) use. Santroller
// generates these from proto/enums.proto; only the names matter here.
#pragma once
typedef enum {
    SubType_Gamepad = 0,
    SubType_GuitarHeroGuitar,
    SubType_GuitarHeroDrums,
    SubType_DjHeroTurntable,
    SubType_Taiko,
    SubType_PopNMusic,
    SubType_BeatMania,
    SubType_GuitarFreaks,
    SubType_DrumMania,
} SubType;
#ifdef __cplusplus
#define Gamepad SubType_Gamepad
#define GuitarHeroGuitar SubType_GuitarHeroGuitar
#define GuitarHeroDrums SubType_GuitarHeroDrums
#define DjHeroTurntable SubType_DjHeroTurntable
#define Taiko SubType_Taiko
#endif
