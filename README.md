# Streetball 3x3

Anschreibe-App für 3x3-Basketball als Web-App für iPhone und iPad.

**Funktionen**
- Punkte zählen (+1 / +2), Teamfouls zählen
- Spieluhr (optional) und Shotclock mit automatischem Reset nach Punkten und Fouls
- Spielende bei Punktelimit, bei Ablauf der Zeit oder per Hand; bei Gleichstand: Unentschieden oder „nächster Punkt entscheidet“
- Option „Check-Ball nach Korb“: Nach Punkten stoppen die Uhren, weiter mit „Weiterspielen“
- Rückgängig, Spielverlauf mit Löschen einzelner Einträge, Stand per Hand bearbeiten
- Vorlagen: FIBA 3x3 (10 min, 21 Punkte, 12 s Shotclock), Hobby (21 Punkte, ohne Uhr) oder eigene Werte
- Spiele werden auf dem Gerät gespeichert, Export/Import als JSON-Datei
- Offline nutzbar (PWA), Bildschirm bleibt während des Spiels an, Buzzer-Ton

## Auf dem iPhone/iPad installieren
1. In Safari `https://bengedeonkandlen.github.io/streetball-3x3/` öffnen.
2. Teilen-Symbol → **Zum Home-Bildschirm**.

## Lokal starten
```bash
python3 -m http.server 8123
```
Dann `http://localhost:8123` öffnen.

## Neue Version veröffentlichen
In `sw.js` die Konstante `CACHE` hochzählen (z. B. `sb3x3-v2`), committen und pushen. Geräte laden die neue Version beim übernächsten Öffnen.
