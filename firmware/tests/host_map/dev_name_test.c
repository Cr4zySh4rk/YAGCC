// Host test for the custom device name (dev_name.h, ext bytes 328..353). cc -I../../src dev_name_test.c ../../src/ext_config.c
#include <stdio.h>
#include <string.h>
#include "dev_name.h"
#include "ext_config.h"

static int fails;
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)

static void setn(uint8_t *b, const char *s) { memset(b, 0, DEVNAME_LEN); memcpy(b, s, strlen(s)); }
// what usb_descriptors.c / bt.c build: the custom name as it is, else the identity's default
static const char *prod(const uint8_t *b, const char *def, char *out) { return devname_product(b, def, out, 40); }

int main(void) {
    uint8_t b[DEVNAME_LEN]; char o[64];
    memset(b, 0, sizeof b);
    CHECK(devname_valid(b));
    // empty -> the old defaults exactly
    CHECK(!strcmp(prod(b, "YAGCC Guitar Controller", o), "YAGCC Guitar Controller"));
    CHECK(!strcmp(prod(b, "YAGCC Guitar (PS4)", o), "YAGCC Guitar (PS4)"));
    CHECK(!strcmp(prod(b, "YAGCC Guitar", o), "YAGCC Guitar"));
    // a custom name is the whole name, no mode suffix, for every identity
    setn(b, "Adi");
    CHECK(devname_valid(b));
    const char *defs[] = {"YAGCC Guitar Controller", "YAGCC Guitar (HID)", "YAGCC Guitar (Keyboard)", "YAGCC Guitar", "YAGCC Guitar (PS4)", "YAGCC Guitar (PS5)"};
    for (int i = 0; i < 6; i++) CHECK(!strcmp(prod(b, defs[i], o), "Adi"));
    setn(b, "Two Words"); CHECK(devname_valid(b) && !strcmp(prod(b, defs[0], o), "Two Words"));
    setn(b, "0123456789ABCDEFGHIJKLMNO");                                   // 25 chars: the limit
    CHECK(strlen((char *)b) == 25 && devname_valid(b) && !strcmp(prod(b, defs[0], o), "0123456789ABCDEFGHIJKLMNO"));
    setn(b, "0123456789ABCDEFGHIJKLMNOP");                                  // 26 stored bytes, no NUL: too long
    CHECK(!devname_valid(b) && !strcmp(prod(b, defs[0], o), "YAGCC Guitar Controller"));
    setn(b, " Adi"); CHECK(!devname_valid(b));
    setn(b, "Adi "); CHECK(!devname_valid(b));
    setn(b, "A\x7F"); CHECK(!devname_valid(b));
    setn(b, "A\x1F"); CHECK(!devname_valid(b));
    setn(b, "\xC3\xA9"); CHECK(!devname_valid(b));                          // non-ASCII
    setn(b, "Adi"); b[8] = 'x'; CHECK(!devname_valid(b));                   // data after the NUL
    setn(b, "Adi"); b[25] = 'x'; CHECK(!devname_valid(b));                  // ... also in the last byte
    // 0.46 pages (16 byte field, bytes 344..353 zero) stay valid
    memset(b, 0, sizeof b); memcpy(b, "Adi", 3); CHECK(devname_valid(b));
    // string builder truncates safely
    CHECK(devname_cat3(o, 5, "abc", "def", "") == 4 && !strcmp(o, "abcd"));
    char small[8]; setn(b, "0123456789"); CHECK(!strcmp(devname_product(b, "x", small, sizeof small), "0123456"));
    // real-device identities never use the name (usb_descriptors.c keeps their literal strings); manufacturer stays YAGCC
    CHECK(!strcmp(DEVNAME_MANUF, "YAGCC"));
    // BLE: GAP name = the name (or "YAGCC <mode>"); the advertised name is shortened beyond 18 bytes
    bool sh; char def[24];
    devname_cat3(def, sizeof def, "YAGCC", " ", "XInput"); memset(b, 0, sizeof b);
    CHECK(!strcmp(prod(b, def, o), "YAGCC XInput") && devname_adv_len(strlen(o), &sh) == 12 && !sh);
    devname_cat3(def, sizeof def, "YAGCC", " ", "Xbox One");
    CHECK(!strcmp(prod(b, def, o), "YAGCC Xbox One") && devname_adv_len(strlen(o), &sh) == 14 && !sh);
    setn(b, "Adi"); CHECK(!strcmp(prod(b, def, o), "Adi") && devname_adv_len(strlen(o), &sh) == 3 && !sh);
    setn(b, "123456789012345678"); CHECK(devname_adv_len(strlen(prod(b, def, o)), &sh) == 18 && !sh);     // exactly fits: complete name
    setn(b, "1234567890123456789"); CHECK(devname_adv_len(strlen(prod(b, def, o)), &sh) == 18 && sh);     // 19: shortened
    setn(b, "0123456789ABCDEFGHIJKLMNO"); CHECK(devname_adv_len(strlen(prod(b, def, o)), &sh) == 18 && sh && strlen(o) == 25);
    // ext page
    ext_config_t e; ext_defaults(&e);
    CHECK(offsetof(ext_config_t, dev_name) == 328 && sizeof e.dev_name == 26 && ext_validate(&e, NULL));
    memcpy(e.dev_name, "Adi", 3); ext_seal(&e); CHECK(ext_validate(&e, NULL));
    memcpy(e.dev_name, "0123456789ABCDEFGHIJKLMNO", 25); ext_seal(&e); CHECK(ext_validate(&e, NULL));
    memcpy(e.dev_name, "0123456789ABCDEFGHIJKLMNOP", 26); ext_seal(&e); CHECK(!ext_validate(&e, NULL));
    ext_defaults(&e); e.dev_name[0] = 0x01; ext_seal(&e); CHECK(!ext_validate(&e, NULL));
    printf(fails ? "dev_name: %d FAILED\n" : "dev_name: ok\n", fails);
    return fails != 0;
}
