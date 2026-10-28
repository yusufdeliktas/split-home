# Split Home – Ev Masrafları

Aynı evde yaşayan 2 veya daha fazla arkadaşın ortak masraflarını paylaşmasını sağlayan web uygulaması.
Telefondan ve bilgisayardan tarayıcıyla çalışır, kurulum gerektirmez.

**Uygulama:** https://yusufdeliktas.github.io/split-home/

## Özellikler

- Ev oluşturup arkadaşları davet linki veya ev koduyla eve katma
- Masrafları eşit ya da kişiye özel tutarlarla bölme
- Kategoriler (market, kira, faturalar, internet…)
- Herkesin bakiyesi ve **"kim kime ne kadar ödemeli"** önerisi (en az sayıda transferle)
- Ödeme kaydetme ("Ödendi ✓" ile tek dokunuşla)
- Aylık özet: kategori dağılımı, kim ne ödedi
- Excel'e (CSV) aktarma
- Gerçek zamanlı ortak veri: biri masraf eklediğinde herkes anında görür
- Telefonda "Ana ekrana ekle" ile uygulama gibi kullanılabilir

## Kullanım

1. Bir kişi uygulamayı açar, **Yeni ev oluştur** ile ev adını ve ev arkadaşlarını yazar.
2. **Davet et** butonuyla linki WhatsApp vb. üzerinden diğerlerine gönderir.
3. Linke tıklayan herkes "Sen kimsin?" ekranında kendi ismini seçer.

> Linki veya ev kodunu bilen herkes o eve erişebilir. Sadece ev arkadaşlarınızla paylaşın.

## Firebase kurulumu (ortak veri için, bir kere yapılır)

Firebase ayarı yapılmadan uygulama **deneme modunda** çalışır; veriler sadece o cihazda kalır.

1. https://console.firebase.google.com adresine gidip Google hesabıyla **Proje ekle** → isim: `split-home` (Analytics kapalı olabilir).
2. Sol menü **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save**.
3. Aynı sayfada **Settings → Authorized domains → Add domain** → `yusufdeliktas.github.io`.
4. Sol menü **Build → Firestore Database → Create database** → konum `eur3 (europe-west)` → **production mode**.
5. Firestore'da **Rules** sekmesine bu repodaki [`firestore.rules`](firestore.rules) dosyasının içeriğini yapıştırıp **Publish**.
6. **Proje ayarları (⚙️) → Genel → Uygulamalarınız → Web (`</>`)** → takma ad `split-home` → **Register app**.
   Gösterilen `firebaseConfig` değerlerini [`firebase-config.js`](firebase-config.js) dosyasına yapıştırın.
7. Değişikliği GitHub'a gönderin; birkaç dakika içinde site güncellenir.

`firebase-config.js` içindeki değerler gizli değildir (her Firebase web uygulamasında herkese açıktır).
Veriye erişimi `firestore.rules` sınırlar: evlerin listesi alınamaz, ev ancak kodu bilinerek açılabilir.

Ücretsiz Spark planı bir ev için fazlasıyla yeterlidir (günde 50.000 okuma / 20.000 yazma).

## Yerelde çalıştırma

```sh
python -m http.server 8000
# http://localhost:8000
```

## Dosyalar

| Dosya | Açıklama |
| --- | --- |
| `index.html`, `style.css` | Arayüz |
| `app.js` | Ekranlar ve işlemler |
| `logic.js` | Para hesapları, bölüşüm ve borç kapatma algoritması |
| `store.js` | Veri katmanı (Firestore veya deneme modu için tarayıcı hafızası) |
| `firebase-config.js` | Firebase bağlantı ayarları |
| `firestore.rules` | Veritabanı güvenlik kuralları |
