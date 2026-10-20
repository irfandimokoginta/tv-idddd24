# TV Indonesia — modul TizenBrew

Pemutar IPTV channel Indonesia untuk TV Samsung (Tizen) lewat TizenBrew.
Memakai **hls.js** sehingga stream HLS (`.m3u8`) bisa diputar, dan sepenuhnya dikendalikan remote.

Sumber channel: `app/playlist/indonesia.m3u`, playlist kurasi berisi ±139 channel Indonesia
(TVRI nasional & 33 TVRI daerah, RRI Net, Metro TV, CNN/CNBC Indonesia, BeritaSatu, TV religi, edukasi, dan TV lokal).
Hanya memakai server resmi stasiun atau hosting stasiun lokal; restream channel berbayar/komersial dari server pihak ketiga tidak dimasukkan.
Banyak channel punya sumber cadangan; jika sumber pertama gagal, aplikasi otomatis mencoba berikutnya.

## Struktur

```
package.json        konfigurasi modul TizenBrew (wajib di root repo)
app/index.html      tampilan
app/app.js          logika: playlist, pemutar, remote
app/hls.min.js      hls.js 1.7.3 (lisensi Apache-2.0, lihat app/hls.LICENSE)
app/playlist/indonesia.m3u   playlist kurasi
tools/curate.py     skrip penyusun playlist (dari iptv-org, mgi24/tvdigital, Free-TV)
```

## Pasang di TV

1. Buat repo **publik** baru di GitHub, misalnya `tv-indonesia`.
2. Unggah semua isi folder ini (Add file → Upload files). Pastikan `package.json` ada di root repo, bukan di dalam subfolder.
3. Di TV: buka TizenBrew → tombol **hijau** → **Add GitHub Module** → ketik `usernameanda/tv-indonesia`.
4. Buka **TV Indonesia** dari layar utama TizenBrew.

## Tombol remote

Bisa dipakai penuh dengan **Samsung Smart Remote** (remote tanpa tombol warna/angka).

| Tombol | Fungsi |
|---|---|
| ▲ ▼ | Pilih channel di daftar / ganti channel saat layar penuh |
| OK | Putar channel, atau jalankan baris menu |
| ► | Tandai/hapus favorit pada channel yang dipilih |
| CH ▲▼ (rocker channel) | Ganti channel kapan saja |
| BACK | Sembunyikan/tampilkan daftar; keluar jika belum ada yang diputar |

Di bagian atas daftar ada tiga baris menu (tekan ▲ dari channel pertama):
**Kategori** (Nasional, Berita, TVRI Daerah, Religi, Edukasi, TV Lokal), **Tampilkan** (semua / favorit saja), dan **Muat ulang**.

Jika memakai remote dengan tombol warna/angka: MERAH = favorit, HIJAU = favorit saja,
KUNING = kategori, BIRU = muat ulang, angka = lompat ke nomor channel.

Channel yang gagal diputar diberi tanda ✕. Favorit dan channel terakhir tersimpan di TV, jadi saat dibuka lagi langsung melanjutkan channel terakhir.

## Mengubah atau menambah playlist

Edit `CONFIG.playlists` di bagian atas `app/app.js`. Bisa lebih dari satu URL.
Channel dengan nama sama digabung otomatis dan URL-nya dipakai sebagai cadangan.

Playlist ini juga bisa dipakai di aplikasi IPTV lain lewat:
`https://cdn.jsdelivr.net/gh/usernameanda/tv-indonesia/app/playlist/indonesia.m3u`

Memperbarui playlist (butuh Python 3):
```
curl -sLO https://raw.githubusercontent.com/iptv-org/iptv/master/streams/id.m3u
curl -sLO https://raw.githubusercontent.com/mgi24/tvdigital/main/idwork.m3u
curl -sLO https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8
python3 tools/curate.py id.m3u idwork.m3u playlist.m3u8 > app/playlist/indonesia.m3u
```

## Memperbarui kode

TizenBrew mengambil file lewat jsDelivr, yang menyimpan cache repo GitHub sampai beberapa jam.
Setelah mengubah kode, naikkan `version` di `package.json`, lalu bersihkan cache di
https://www.jsdelivr.com/tools/purge (isi `https://cdn.jsdelivr.net/gh/usernameanda/tv-indonesia/`), kemudian buka ulang modulnya.

## Uji di laptop

Buka folder ini dengan server lokal (misalnya `npx serve .`) lalu buka `/app/index.html` di Chrome.
Gunakan panah, Enter, Esc (BACK), PageUp/PageDown, angka, serta R/G/Y/B untuk tombol warna.

## Catatan

Playlist iptv-org hanya berisi siaran yang dipublikasikan terbuka oleh stasiunnya. Sebagian channel bisa mati, berganti alamat, atau dibatasi wilayah; itu di luar kendali aplikasi ini.
