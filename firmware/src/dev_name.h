// Custom device name (firmware 0.51): ext page bytes 328..353, up to 25 printable ASCII characters (0x20..0x7E),
// NUL padded. The stored name is the WHOLE USB product name / Bluetooth name of our own identities (0.46..0.50 stored a
// prefix of at most 10 characters that got " Guitar Controller" etc. appended). Empty = the default names below.
// Pure helpers so they can be tested on a PC (tests/host_map/dev_name_test.c).
#ifndef YACC_DEV_NAME_H_
#define YACC_DEV_NAME_H_
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#define DEVNAME_LEN 26   // storage in the ext page
#define DEVNAME_MAX 25   // longest name allowed
#define DEVNAME_MANUF "YAGCC"   // USB manufacturer string of our own identities (never customised)

// Valid stored name: printable ASCII up to the first NUL, zeros after it, no leading or trailing space
static inline bool devname_valid(const uint8_t *b) {
    size_t n = 0;
    while (n < DEVNAME_LEN && b[n]) { if (b[n] < 0x20 || b[n] > 0x7E) return false; n++; }
    if (n > DEVNAME_MAX) return false;
    for (size_t i = n; i < DEVNAME_LEN; i++) if (b[i]) return false;
    return n == 0 || (b[0] != ' ' && b[n - 1] != ' ');
}

// The name to show: the stored name, or `def` (the identity's default name) when empty or invalid.
// out needs DEVNAME_LEN + 1 bytes at least and room for `def` (longest default: 23 characters).
static inline const char *devname_product(const uint8_t *b, const char *def, char *out, size_t cap) {
    size_t n = 0;
    if (devname_valid(b)) while (n < DEVNAME_LEN && b[n] && n + 1 < cap) { out[n] = (char)b[n]; n++; }
    if (n == 0) { for (const char *p = def; *p && n + 1 < cap; p++) out[n++] = *p; }
    out[n] = 0;
    return out;
}

// dst = a + b + c (any may be ""), truncated to cap - 1 characters. Returns the length.
static inline size_t devname_cat3(char *dst, size_t cap, const char *a, const char *b, const char *c) {
    size_t n = 0;
    const char *parts[3] = {a, b, c};
    for (int i = 0; i < 3; i++) for (const char *p = parts[i]; *p && n + 1 < cap; p++) dst[n++] = *p;
    dst[n] = 0;
    return n;
}

// Largest name that fits the 31 byte advertising packet next to flags, the HID UUID and the appearance
#define DEVNAME_ADV_MAX (31 - 11 - 2)
// Advertised name length and whether it is the SHORTENED name
static inline uint8_t devname_adv_len(size_t name_len, bool *shortened) {
    *shortened = name_len > DEVNAME_ADV_MAX;
    return (uint8_t)(*shortened ? DEVNAME_ADV_MAX : name_len);
}
#endif
