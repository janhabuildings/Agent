import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
export async function speak(text: string) {
  if (Capacitor.isNativePlatform()) { await TextToSpeech.stop(); await TextToSpeech.speak({text,lang:'en-US',rate:1}); }
  else if ('speechSynthesis' in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }
}
export async function stopSpeaking() {
  if (Capacitor.isNativePlatform()) await TextToSpeech.stop();
  else window.speechSynthesis?.cancel();
}
export async function listen(onText: (text:string)=>void, onEnd:()=>void, onError:(text:string)=>void): Promise<()=>void> {
  if (Capacitor.isNativePlatform()) {
    const permission = await SpeechRecognition.requestPermissions();
    if (permission.speechRecognition !== 'granted') throw new Error('Please allow microphone and speech recognition access in Settings.');
    void SpeechRecognition.start({language:'en-US',maxResults:1,prompt:'Ask about your email',partialResults:false}).then(result=>{
      if(result.matches?.[0]) onText(result.matches[0]);
      onEnd();
    }).catch(()=>{onError('Speech recognition stopped. Please try again.');onEnd();});
    return ()=>{void SpeechRecognition.stop();};
  }
  const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if(!Recognition) throw new Error('Voice input is unavailable in this browser. Try Chrome or Safari, or type your question.');
  const recognition = new Recognition();
  recognition.lang='en-US'; recognition.interimResults=false; recognition.continuous=false;
  recognition.onresult=(event:any)=>onText(event.results[0][0].transcript);
  recognition.onend=onEnd;
  recognition.onerror=(event:any)=>{onError(event.error==='not-allowed'?'Microphone access was denied. Allow it in browser settings or type your question.':`Voice input stopped (${event.error}). Please try again.`);onEnd();};
  recognition.start(); return ()=>recognition.abort();
}
