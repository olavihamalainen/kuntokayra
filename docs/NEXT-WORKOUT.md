# Seuraava treeni ja keskeneräinen kirjaus

Käyttäjä kokeili ominaisuudet esikatselussa ja hyväksyi niiden sekä 18.11.2026 viimeistelyn siirron GitHub-versioon. Sovelluksen osoite säilyy <https://olavihamalainen.github.io/kuntokayra/>.

## Kotikortit ja ehdotettu treeni

Seuraava treeni käyttää viikkolaskurin aiempaa paikkaa kolmen yhtä suuren mittarikortin ruudukossa. Se näyttää ohjelman mukaisen seuraavan kategorian ja sen viimeisimmän treenipäivän. Painaminen avaa viimeisimmän saman kategorian treenin liikkeet, sarjamäärät ja kunkin sarjan painon. Toistot jäävät käyttäjän nimenomaisesta valinnasta tyhjiksi. Painot näkyvät liikkeen muistamassa kg/lbs-yksikössä, eivätkä ehdotukset käynnistä sarjataukoa. Ilman aiempaa saman kategorian treeniä avataan tyhjä liike.

Uusi lisättävä sarja kopioi edelleen nykyisen ensimmäisen sarjan painon, eikä ensimmäisen muutos korvaa muita sarjoja. Vertailutieto näyttää esimerkiksi **Viimeksi 50 kg × 8 · 17.11.** saman sarjaindeksin ja liikkeen viimeisimmän treenikerran perusteella kategorioiden yli. Vertailupaino muuntuu editorin yksikköön. Paino- ja yöaikakortit avaavat vastaavan kehityskäyrän 30 päivän jaksolle.

## Luonnos ja tallennussopimus

Uusi kirjaus tallentuu 500 ms kirjoitustauon jälkeen luonnoksena. Piiloutuminen, pagehide ja sulkeminen yrittävät tallentaa viimeiset arvot heti. Pelkkä tyhjän lomakkeen avaaminen ei luo luonnosta. Kotikortti vaihtuu Jatka treeniä -kortiksi; editorissa on pieni tallennustila ja alhaalla Jatka myöhemmin, Tallenna treeni ja Poista treeni. Valmiin treenin tavallinen muokkaus säilyttää Peruuta-toimintansa.

Luonnos on valinnainen `workoutPending` samassa `localStorage['kuntokayra_v1']`-tilassa: `{id,savedAt,date,category?,exercises}`. Liike sisältää `{name,unit,unitEdited,sets}` ja sarja `{weight,reps,weightEdited,weightSuggested,completed,canonicalWeight?}`. Paino ja toistot ovat rajattuja merkkijonoja, jotta osittaiset luvut, pilkkudesimaalit ja tarkoituksella tyhjät kentät säilyvät. Päivämäärä saa olla keskeneräisenä tyhjä. Kategorian puuttuminen, `null` tai tyhjä merkkijono sallitaan luonnoksessa; valmis uusi treeni vaatii kelvollisen kategorian.

Metadata tallennetaan nimenomaisina kenttinä, ei raakana editoriobjektina tai `_`-alkuisina ominaisuuksina. Valinnainen `canonicalWeight` säilyttää täsmällisen kilogrammapainon toistuvissa yksikkövaihdoissa ja validoidaan näyttöpainoa vasten. Käsin tyhjennettyjä kenttiä ja yksikön valintaa ei korvata jatkamisen yhteydessä. Täytetyt vanhat sarjat merkitään tehdyiksi, jotta niiden korjaaminen ei aloita taukoa uudelleen.

Luonnos ei kuulu valmiisiin treeneihin tai käyriin. Käynnistys ei kirjoita tallennusta eikä avaa luonnosta automaattisesti. Jatkaminen on käyttäjän valinta. Valmiin treenin tallennus lisää merkinnän ja poistaa vain sen oman luonnoksen samassa atomisessa kirjoituksessa. Vanhan treenin muokkaaminen tai poisto säilyttää erillisen uuden luonnoksen.

Poista treeni vaatii kaksi peräkkäistä vahvistusta. Se poistaa avoimen uuden luonnoksen tai muokattavan tallennetun treenin. Kumman tahansa vahvistuksen peruuttaminen ja tallennusvirhe jättävät tiedot sekä editorin ennalleen. Luonnoksen viivästetyt kirjoitukset ja sarjataukojen aloitukset perutaan onnistuneessa poistossa.

Version 1 varmuuskopio säilyttää luonnoksen ja sen tunnisteen; vanha kopio ilman kenttää toimii edelleen. Epäkelpo luonnos hylkää koko tuonnin ennen nykyisten tietojen korvaamista. Onnistunut tuonti ja merkintöjen tyhjennys peruvat editorin viiveet, jotta myöhäiset callbackit eivät palauta vanhaa luonnosta. Muut kirjaukset, Garmin-yhdistäminen ja asetusten muutos säilyttävät erillisen luonnoksen. Ohjelman vaihtuessa alkuperäinen luonnoskategoria säilyy valittavana.

## Järjestäminen ja suurennettu käyrä

Järjestä liikkeet on aluksi suljettu lista. Kahvasta vedetään Pointer Events -tapahtumilla; nuolipainikkeet ja kahvan nuolinäppäimet ovat vaihtoehto. Koko liikeolio sarjoineen siirtyy. Vedon aikana DOM säilyy, pointerup vahvistaa järjestyksen ja pointercancel peruu. Autovieritys kohdistuu listaan. Järjestely säilyttää editorin vierityksen ja palauttaa fokuksen siirrettyyn kahvaan. Keskeneräiset taukoviiveet seuraavat liike-/sarjaolioita, eivät niiden vanhoja indeksejä.

Suurennetun käyrän `.chart-dialog-head` ja sulkupainike ovat vieritettävän `.chart-expanded`-pinnan ulkopuolella. Otsikon oma kerros ja SVG:n rajaus estävät piirto- ja osumapintoja peittämästä sulkua. Resize/orientationchange mittaavat käyrän uudelleen ja tekevät jälkitarkistuksen asettelun tasauduttua. Ulommat dialogivieritykset nollataan, sisäisen käyräpinnan vieritys ja pistevalinta säilyvät. Sulkeminen peruu jälkitarkistuksen. Tavallisten lomakkeiden korkeutta ei sidota näppäimistön visualViewport-arvoihin.

## Tarkistukset

GitHub-version `npm test` sisältää 190 synteettistä testiä: aiemmat 142, ohjelman 17, kortin/luonnoksen/järjestelyn 19 ja viimeistelyn 12 testiä. Ne kattavat tietojen ja sarjapainojen säilymisen, ohjelmien kierron, kylmän uudelleenavauksen, osittaiset kentät, tallennusvirheet, vienti–tuonnin, atomisen valmistumisen ja poiston, molempien vahvistusten peruutuksen, pikakäyrät ja simuloidut toistuvat näytön käännöt sekä sulkemisen aktiivisen taukoajastimen kanssa. DOM-simulaatio ei varmista oikean iPhonen asettelua tai kosketusosumia. Garmin-Worker säilyy tuotannon versiona 2026-11-17.3; selainkuoren versio on `kuntokayra-shell-v15`.
