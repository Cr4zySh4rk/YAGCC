// Host test for the custom device name (dev_name.h, ext bytes 328..343). cc -I../../src dev_name_test.c ../../src/ext_config.c
#include <stdio.h>
#include <string.h>
#include "dev_name.h"
#include "ext_config.h"

static int fails;
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)

static void setn(uint8_t *b, const char *s) { memset(b, 0, DEVNAME_LEN); memcpy(b, s, strlen(s)); }
static const char *prod(const uint8_t *b, const char *tail, char *out) {   // what usb_descriptors.c builds
    char pfx[DEVNAME_LEN + 1]; devname_prefix(b, pfx); devname_cat3(out, 64, pfx, tail, ""); return out;
}

int main(void) {
    uint8_t b[DEVNAME_LEN]; char pfx[DEVNAME_LEN + 1], o[64];
    memset(b, 0, sizeof b);
    CHECK(devname_valid(b));
    CHECK(!strcmp(devname_prefix(b, pfx), "YAGCC"));                       // empty -> YAGCC
    CHECK(!strcmp(prod(b, " Guitar Controller", o), "YAGCC Guitar Controller"));
    CHECK(!strcmp(prod(b, " Guitar (PS4)", o), "YAGCC Guitar (PS4)"));
    setn(b, "Adi");
    CHECK(devname_valid(b) && !strcmp(devname_prefix(b, pfx), "Adi"));
    CHECK(!strcmp(prod(b, " Guitar (HID)", o), "Adi Guitar (HID)"));
    CHECK(!strcmp(prod(b, " Guitar", o), "Adi Guitar"));                    // Auto
    CHECK(!strcmp(prod(b, " Guitar (Keyboard)", o), "Adi Guitar (Keyboard)"));
    CHECK(!strcmp(prod(b, " Guitar (PS5)", o), "Adi Guitar (PS5)"));
    CHECK(!strcmp(prod(b, " Guitar Controller", o), "Adi Guitar Controller"));
    setn(b, "Two Words");
    CHECK(devname_valid(b));
    setn(b, "0123456789");                                                  // 10 chars: the limit
    CHECK(devname_valid(b) && !strcmp(devname_prefix(b, pfx), "0123456789"));
    setn(b, "01234567890");                                                 // 11: rejected
    CHECK(!devname_valid(b) && !strcmp(devname_prefix(b, pfx), "YAGCC"));
    setn(b, "0123456789ABCDEF");                                            // 16 stored bytes, too long
    CHECK(!devname_valid(b));
    setn(b, " Adi"); CHECK(!devname_valid(b));
    setn(b, "Adi "); CHECK(!devname_valid(b));
    setn(b, "A\x7F"); CHECK(!devname_valid(b));
    setn(b, "A\x1F"); CHECK(!devname_valid(b));
    setn(b, "\xC3\xA9"); CHECK(!devname_valid(b));                          // non-ASCII
    setn(b, "Adi"); b[8] = 'x'; CHECK(!devname_valid(b));                   // data after the NUL
    // string builder truncates safely
    CHECK(devname_cat3(o, 5, "abc", "def", "") == 4 && !strcmp(o, "abcd"));
    // BLE: "<prefix> <mode>", advertised name shortened beyond 18 bytes
    bool sh; setn(b, "Adi"); devname_prefix(b, pfx); devname_cat3(o, 40, pfx, " ", "XInput");
    CHECK(!strcmp(o, "Adi XInput") && devname_adv_len(strlen(o), &sh) == 10 && !sh);
    setn(b, "0123456789"); devname_prefix(b, pfx); devname_cat3(o, 40, pfx, " ", "Xbox One");
    CHECK(strlen(o) == 19 && devname_adv_len(strlen(o), &sh) == 18 && sh);
    devname_prefix(b, pfx); memset(b, 0, sizeof b); devname_prefix(b, pfx); devname_cat3(o, 40, pfx, " ", "PS3 GH");
    CHECK(!strcmp(o, "YAGCC PS3 GH") && devname_adv_len(strlen(o), &sh) == 12 && !sh);
    // ext page
    ext_config_t e; ext_defaults(&e);
    CHECK(offsetof(ext_config_t, dev_name) == 328 && sizeof e.dev_name == 16 && ext_validate(&e, NULL));
    memcpy(e.dev_name, "Adi", 3); ext_seal(&e); CHECK(ext_validate(&e, NULL));
    memcpy(e.dev_name, "01234567890", 11); ext_seal(&e); CHECK(!ext_validate(&e, NULL));
    ext_defaults(&e); e.dev_name[0] = 0x01; ext_seal(&e); CHECK(!ext_validate(&e, NULL));
    printf(fails ? "dev_name: %d FAILED\n" : "dev_name: ok\n", fails);
    return fails != 0;
}
