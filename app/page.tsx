"use client"
import Image from "next/image"
import epl from "./assets/epl.jpg"
import { useChat } from "ai/react"
import { Message } from "ai"

const Home = () =>{
    const noMessages = true
    return(
        <main>
            <Image src={epl} width={250} height={250} alt="EPL Logo" />
            <section>
                {noMessages ?(
                    <>
                    <p className="starter-text"> The late to news place where you can ask about any Ethiopian Premier League quessstions, up to date and ready to answer.
                    </p>
                    <br/>
                    </>
                ) : (
                    <>
                    </>
                )}
            </section>
        </main>
    )
}

export default Home